use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use gbr::config::Paths;
use gbr::devices::Devices;
use gbr::pairing::{PendingPairing, QrPayload};
use gbr::{agent, server, spike, tls};
use tokio::io::AsyncBufReadExt;

#[derive(Parser)]
#[command(name = "gbr", version, about = "Grok Build Remote bridge")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the bridge. Listen on the Mac's Tailscale address, e.g. --listen 100.101.102.103:7443
    Serve {
        #[arg(long, default_value = "127.0.0.1:7443")]
        listen: SocketAddr,
        /// Path to the grok binary (launchd has a minimal PATH, so an absolute path is safest)
        #[arg(long, default_value = "grok")]
        grok_bin: PathBuf,
        /// Also write prompt text to the audit log (off by default)
        #[arg(long)]
        log_prompts: bool,
        /// Start the sessions the phone opens in Grok Build's auto-review mode (never always-approve)
        #[arg(long)]
        auto_review: bool,
        /// Allow listening on all interfaces (0.0.0.0 / ::). Don't.
        #[arg(long)]
        i_know_what_im_doing: bool,
    },
    /// Pair a phone: shows a QR code to scan with the app
    Pair {
        /// Address the phone should connect to, e.g. 100.101.102.103:7443 (default: `tailscale ip -4` + :7443)
        #[arg(long)]
        addr: Option<String>,
    },
    /// List or revoke paired phones
    Devices {
        #[command(subcommand)]
        action: DevicesCmd,
    },
    /// Stop a running `gbr serve` (closes every phone connection)
    Stop,
    /// Milestone 0: attach to a session open in the TUI and print everything (see README)
    Spike {
        #[arg(long)]
        session: String,
        #[arg(long)]
        cwd: String,
        #[arg(long, default_value = "grok")]
        grok_bin: PathBuf,
    },
    /// Print the bridge certificate fingerprint
    Fingerprint,
}

#[derive(Subcommand)]
enum DevicesCmd {
    List,
    Revoke { name: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("GBR_LOG")
                .unwrap_or_else(|_| "gbr=info".into()),
        )
        .init();
    let cli = Cli::parse();
    let paths = Paths::resolve()?;
    match cli.command {
        Cmd::Serve {
            listen,
            grok_bin,
            log_prompts,
            auto_review,
            i_know_what_im_doing,
        } => {
            let opts = ServeOptions {
                log_prompts,
                auto_review,
                any_interface: i_know_what_im_doing,
            };
            serve(paths, listen, grok_bin, opts).await
        }
        Cmd::Pair { addr } => pair(paths, addr).await,
        Cmd::Devices { action } => devices(paths, action),
        Cmd::Stop => stop(paths),
        Cmd::Spike {
            session,
            cwd,
            grok_bin,
        } => spike::run(grok_bin, session, cwd).await,
        Cmd::Fingerprint => {
            let id = tls::load_or_create(&paths)?;
            println!("{}", tls::display_fingerprint(&id.fingerprint()));
            Ok(())
        }
    }
}

struct ServeOptions {
    log_prompts: bool,
    auto_review: bool,
    any_interface: bool,
}

async fn serve(
    paths: Paths,
    listen: SocketAddr,
    grok_bin: PathBuf,
    opts: ServeOptions,
) -> Result<()> {
    if listen.ip().is_unspecified() && !opts.any_interface {
        bail!(
            "refusing to listen on {listen}: that exposes the bridge to every network this Mac is on. \
             Use the Mac's Tailscale address (`tailscale ip -4`)."
        );
    }
    let id = tls::load_or_create(&paths)?;
    let tls_config = tls::server_config(&id)?;
    let grok_version = agent::grok_version(&grok_bin).await;
    let listener = tokio::net::TcpListener::bind(listen)
        .await
        .with_context(|| format!("listening on {listen}"))?;
    std::fs::write(paths.pid(), std::process::id().to_string())?;
    let state = Arc::new(server::State::new(
        paths.clone(),
        id.fingerprint(),
        grok_bin,
        grok_version.clone(),
        opts.log_prompts,
        opts.auto_review,
    ));
    let mode = if opts.auto_review {
        "auto-review"
    } else {
        "ask"
    };
    let detail = format!("{listen}, new sessions: {mode}");
    state.audit.log("-", "start", &detail);
    tracing::info!(
        "gbr listening on {listen} (grok {grok_version}); bridge fingerprint {}",
        tls::display_fingerprint(&id.fingerprint())
    );

    let server_task = tokio::spawn(server::serve(listener, state.clone(), tls_config));
    shutdown_signal().await;
    server_task.abort();
    state.shutdown().await;
    state.audit.log("-", "stop", "");
    let _ = std::fs::remove_file(paths.pid());
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn pair(paths: Paths, addr: Option<String>) -> Result<()> {
    let addr = match addr {
        Some(a) => a,
        None => tailscale_addr()
            .context("couldn't get the Tailscale address; pass --addr <tailscale-ip>:7443")?,
    };
    let id = tls::load_or_create(&paths)?;
    let (pending, token) = PendingPairing::create(&paths, server::now())?;
    let payload = serde_json::to_string(&QrPayload {
        gbr: 1,
        addr: addr.clone(),
        fp: id.fingerprint(),
        token,
    })?;
    // Low error correction is fine on a screen and keeps the code small; half blocks draw two
    // rows of modules per line, so it fits in a normal terminal window.
    let qr = qrcode::QrCode::with_error_correction_level(payload.as_bytes(), qrcode::EcLevel::L)?;
    let art = qr
        .render::<qrcode::render::unicode::Dense1x2>()
        .quiet_zone(true)
        .build();
    println!("{art}");
    println!("Scan this with Grok Build Remote. It works once and expires in 5 minutes.");
    println!("Bridge address: {addr}");
    println!(
        "Bridge fingerprint: {}",
        tls::display_fingerprint(&id.fingerprint())
    );
    println!("(Make sure `gbr serve` is running.)\nWaiting for the phone…");

    let device = loop {
        if server::now() > pending.expires_at {
            PendingPairing::clear(&paths)?;
            bail!("pairing code expired");
        }
        match PendingPairing::load(&paths)? {
            Some(PendingPairing {
                device: Some(d), ..
            }) => break d,
            Some(_) => {}
            None => bail!("pairing was cancelled"),
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    };

    println!(
        "\n“{}” wants to pair. Its screen shows: {} {}",
        device.name,
        &device.code[..3],
        &device.code[3..]
    );
    println!("Does the code on the phone match? [y/N]");
    let mut line = String::new();
    let mut stdin = tokio::io::BufReader::new(tokio::io::stdin());
    stdin.read_line(&mut line).await?;
    if line.trim().eq_ignore_ascii_case("y") {
        let mut devices = Devices::load(&paths)?;
        devices.add(&device.name, &device.fingerprint)?;
        devices.save(&paths)?;
        PendingPairing::clear(&paths)?;
        println!("Paired “{}”.", device.name);
    } else {
        PendingPairing::clear(&paths)?;
        println!("Not paired.");
    }
    Ok(())
}

/// The Tailscale CLI: on `PATH`, or inside the Mac app, which doesn't put it on `PATH`.
const TAILSCALE_BINS: [&str; 2] = [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

fn tailscale_addr() -> Result<String> {
    let out = TAILSCALE_BINS
        .iter()
        .find_map(|bin| {
            std::process::Command::new(bin)
                .args(["ip", "-4"])
                .output()
                .ok()
        })
        .context("the tailscale command wasn't found")?;
    if !out.status.success() {
        bail!("`tailscale ip -4` failed");
    }
    let ip = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if ip.is_empty() {
        bail!("no Tailscale IPv4 address");
    }
    Ok(format!("{ip}:7443"))
}

fn devices(paths: Paths, action: DevicesCmd) -> Result<()> {
    let mut devices = Devices::load(&paths)?;
    match action {
        DevicesCmd::List => {
            if devices.devices.is_empty() {
                println!("No paired phones. Run `gbr pair`.");
            }
            for d in &devices.devices {
                println!(
                    "{:<20} {:<9} added {}  {}",
                    d.name,
                    if d.revoked { "revoked" } else { "active" },
                    d.added_at,
                    tls::display_fingerprint(&d.fingerprint[..16.min(d.fingerprint.len())])
                );
            }
        }
        DevicesCmd::Revoke { name } => {
            if !devices.revoke(&name) {
                bail!("no active phone named {name}");
            }
            devices.save(&paths)?;
            println!("Revoked {name}. An open connection from it closes within 20 seconds.");
        }
    }
    Ok(())
}

fn stop(paths: Paths) -> Result<()> {
    let pid =
        std::fs::read_to_string(paths.pid()).context("gbr serve doesn't seem to be running")?;
    let pid = pid.trim();
    if pid.is_empty() || !pid.chars().all(|c| c.is_ascii_digit()) {
        bail!("bad pid file");
    }
    let status = std::process::Command::new("kill")
        .args(["-TERM", pid])
        .status()?;
    if !status.success() {
        bail!("could not stop process {pid}");
    }
    println!("Stopped gbr (pid {pid}).");
    Ok(())
}
