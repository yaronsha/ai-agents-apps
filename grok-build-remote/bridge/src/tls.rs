//! The bridge's TLS identity and the server config.
//!
//! The bridge uses a self-signed certificate. Phones pin its SHA-256 fingerprint (it travels in the
//! pairing QR code), so no certificate authority is involved. Phones must present a client
//! certificate; the handshake accepts any well-formed one, and the server then authorises the
//! connection by looking the certificate's fingerprint up in `devices.json`. An unknown
//! certificate may only send a `pair` message.

use std::sync::Arc;

use anyhow::{Context, Result};
use rustls::client::danger::HandshakeSignatureValid;
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{DigitallySignedStruct, DistinguishedName, ServerConfig, SignatureScheme};
use sha2::{Digest, Sha256};

use crate::config::{write_private, Paths};

pub struct Identity {
    pub cert_der: Vec<u8>,
    pub key_der: Vec<u8>,
}

impl Identity {
    pub fn fingerprint(&self) -> String {
        fingerprint(&self.cert_der)
    }
}

/// Load the bridge identity, creating a new self-signed P-256 certificate on first run.
pub fn load_or_create(paths: &Paths) -> Result<Identity> {
    if paths.cert().exists() && paths.key().exists() {
        return Ok(Identity {
            cert_der: std::fs::read(paths.cert())?,
            key_der: std::fs::read(paths.key())?,
        });
    }
    let id = generate("gbr-bridge")?;
    write_private(&paths.cert(), &id.cert_der)?;
    write_private(&paths.key(), &id.key_der)?;
    Ok(id)
}

/// A fresh self-signed certificate (ECDSA P-256). Also used by tests for fake phones.
pub fn generate(name: &str) -> Result<Identity> {
    let certified = rcgen::generate_simple_self_signed(vec![name.to_string()])
        .context("generating certificate")?;
    Ok(Identity {
        cert_der: certified.cert.der().to_vec(),
        key_der: certified.key_pair.serialize_der(),
    })
}

/// Lowercase hex SHA-256 of a DER certificate.
pub fn fingerprint(der: &[u8]) -> String {
    let digest = Sha256::digest(der);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// `ab12cd34…` → `AB12 CD34 …` for reading aloud or comparing by eye.
pub fn display_fingerprint(fp: &str) -> String {
    fp.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

pub fn server_config(id: &Identity) -> Result<Arc<ServerConfig>> {
    let provider = provider();
    let cert = CertificateDer::from(id.cert_der.clone());
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(id.key_der.clone()));
    let mut config = ServerConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .context("TLS 1.3 not available")?
        .with_client_cert_verifier(Arc::new(AnyClientCert { provider }))
        .with_single_cert(vec![cert], key)
        .context("loading bridge certificate")?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

/// Requires a client certificate and checks that the client owns its key (handshake signature),
/// but leaves the "is this a paired phone?" decision to the server, which knows `devices.json`.
#[derive(Debug)]
struct AnyClientCert {
    provider: Arc<CryptoProvider>,
}

impl ClientCertVerifier for AnyClientCert {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }

    fn client_auth_mandatory(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_hex() {
        let fp = fingerprint(b"hello");
        assert_eq!(fp.len(), 64);
        assert_eq!(
            fp,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert!(display_fingerprint(&fp).starts_with("2CF2 4DBA"));
    }

    #[test]
    fn generated_identity_builds_a_server_config() {
        let id = generate("test").unwrap();
        server_config(&id).unwrap();
    }
}
