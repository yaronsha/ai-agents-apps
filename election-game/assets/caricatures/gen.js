// Generates caricature SVGs: one per politician, in "idle" and "hit" states.
// viewBox 240x300, shown at 120x150 in the game slot. Run: node gen.js
const fs = require('fs');
const path = require('path');

const OUT = '#221C24';
const SW = 4.5;

function faceBlock(id, d, skin, shade, light) {
  return `
<clipPath id="${id}-fc"><path d="${d}"/></clipPath>
<path d="${d}" fill="${shade}"/>
<g clip-path="url(#${id}-fc)">
  <path d="${d}" fill="${skin}" transform="translate(-9 -7)"/>
  <ellipse cx="96" cy="70" rx="34" ry="18" fill="${light}" opacity="0.55"/>
</g>`;
}
const faceOutline = (d) => `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>`;

function ear(cx, cy, skin, shade, flip, s = 1) {
  const rx = 13 * s, ry = 20 * s;
  const k = flip ? -1 : 1;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}" stroke="${OUT}" stroke-width="${SW}"/>
<path d="M${cx + k * 4 * s} ${cy - 10 * s} C${cx - k * 6 * s} ${cy - 8 * s} ${cx - k * 6 * s} ${cy + 8 * s} ${cx + k * 3 * s} ${cy + 10 * s}" fill="none" stroke="${shade}" stroke-width="3.5" stroke-linecap="round"/>`;
}

// one open eye; lid = fraction of the eye hidden by the upper lid
function eye(id, cx, cy, o) {
  const rx = o.rx || 12, ry = o.ry || 10;
  const ir = o.ir || 6.2;
  const lx = cx + (o.look || 0);
  const lid = o.lid || 0;
  let s = `<clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#FFFDF8"/>
<g clip-path="url(#${id})">
  <circle cx="${lx}" cy="${cy + 1}" r="${ir}" fill="${o.iris || '#3B2A22'}"/>
  <circle cx="${lx}" cy="${cy + 1}" r="${ir * 0.5}" fill="#120E12"/>
  <circle cx="${lx - ir * 0.35}" cy="${cy - ir * 0.3}" r="${Math.max(1.6, ir * 0.3)}" fill="#FFFFFF"/>`;
  if (lid > 0) {
    const y = cy - ry + 2 * ry * lid;
    s += `<rect x="${cx - rx - 2}" y="${cy - ry - 2}" width="${2 * rx + 4}" height="${y - (cy - ry) + 2}" fill="${o.lidColor}"/>`;
  }
  s += `</g>
<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${OUT}" stroke-width="3.2"/>`;
  if (lid > 0) {
    const y = cy - ry + 2 * ry * lid;
    const half = rx * Math.sqrt(Math.max(0, 1 - Math.pow((y - cy) / ry, 2)));
    s += `<path d="M${cx - half - 1} ${y} Q${cx} ${y - 3} ${cx + half + 1} ${y}" fill="none" stroke="${OUT}" stroke-width="3.6" stroke-linecap="round"/>`;
  }
  if (o.bags) {
    s += `<path d="M${cx - rx + 2} ${cy + ry + 3} Q${cx} ${cy + ry + 9} ${cx + rx - 2} ${cy + ry + 3}" fill="none" stroke="${o.bags}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  return s;
}

// squeezed-shut eyes for the hit state
function hitEye(cx, cy, side) {
  const k = side === 'l' ? 1 : -1;
  return `<path d="M${cx - k * 10} ${cy - 8} L${cx + k * 6} ${cy} L${cx - k * 10} ${cy + 8}" fill="none" stroke="${OUT}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function hitMouth(cx, cy, s = 1) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${13 * s}" ry="${16 * s}" fill="#5B1620" stroke="${OUT}" stroke-width="${SW}"/>
<path d="M${cx - 9 * s} ${cy + 9 * s} Q${cx} ${cy + 1 * s} ${cx + 9 * s} ${cy + 9 * s} Q${cx} ${cy + 16 * s} ${cx - 9 * s} ${cy + 9 * s} Z" fill="#D9636B"/>
<path d="M${cx - 8 * s} ${cy - 11 * s} L${cx + 8 * s} ${cy - 11 * s}" stroke="#FFFDF8" stroke-width="${4 * s}" stroke-linecap="round"/>`;
}

// tomato splat, drawn last, centred on (x,y)
function splat(x, y, sc = 0.72, rot = -12) {
  sc *= 1.15;
  const blob = 'M0 -40 C10 -48 18 -30 28 -36 C42 -44 46 -24 38 -16 C54 -12 52 6 38 8 C48 20 36 34 24 26 C22 42 4 44 0 32 C-6 46 -26 42 -24 26 C-38 34 -50 20 -38 10 C-54 4 -50 -16 -34 -14 C-44 -30 -26 -44 -16 -32 C-14 -44 -6 -46 0 -40 Z';
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})">
<path d="M-18 24 C-20 44 -22 62 -16 70 C-10 74 -8 64 -10 46 Z" fill="#C42A1B" stroke="${OUT}" stroke-width="3"/>
<path d="M16 22 C18 36 18 48 23 52 C28 54 28 44 24 30 Z" fill="#C42A1B" stroke="${OUT}" stroke-width="3"/>
<path d="${blob}" fill="#D9341F" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M-24 -18 C-14 -28 0 -30 12 -26 C2 -20 -10 -16 -20 -8 Z" fill="#F2785C"/>
<path d="M-30 14 C-14 22 10 24 30 14 C20 26 4 30 -10 26 C-20 24 -26 20 -30 14 Z" fill="#A81E14"/>
<g fill="#F7D46A" stroke="#C99A2E" stroke-width="1">
<ellipse cx="-8" cy="-4" rx="4.5" ry="2.8" transform="rotate(-30 -8 -4)"/>
<ellipse cx="10" cy="4" rx="4.5" ry="2.8" transform="rotate(20 10 4)"/>
<ellipse cx="-16" cy="10" rx="4.5" ry="2.8" transform="rotate(50 -16 10)"/>
<ellipse cx="18" cy="-12" rx="4.5" ry="2.8" transform="rotate(-60 18 -12)"/>
<ellipse cx="0" cy="16" rx="4.5" ry="2.8"/>
</g>
<path d="M6 -30 L12 -42 L16 -30 L28 -32 L19 -23 L24 -12 L13 -18 L4 -10 L6 -22 L-6 -26 Z" fill="#3E8A3A" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
<circle cx="56" cy="-30" r="6" fill="#D9341F" stroke="${OUT}" stroke-width="2.5"/>
<circle cx="-60" cy="-6" r="5" fill="#D9341F" stroke="${OUT}" stroke-width="2.5"/>
<circle cx="50" cy="26" r="3.5" fill="#D9341F" stroke="${OUT}" stroke-width="2"/>
<circle cx="-52" cy="-34" r="3.5" fill="#D9341F" stroke="${OUT}" stroke-width="2"/>
</g>`;
}

// shoulders: jacket, shirt, optional tie
function body(o) {
  const neck = `<path d="M90 190 L90 244 L150 244 L150 190 Z" fill="${o.skinShade}" stroke="${OUT}" stroke-width="${SW}"/>`;
  const jacket = `<path d="M4 304 C10 262 40 238 92 230 L148 230 C200 238 230 262 236 304 Z" fill="${o.suit}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M200 252 C214 264 222 280 226 304 L236 304 C230 270 214 252 200 244 Z" fill="${o.suitShade}"/>`;
  let shirt;
  if (o.collar === 'tie') {
    shirt = `<path d="M88 230 L120 300 L152 230 Z" fill="${o.shirt}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M88 230 L120 254 L104 268 L84 238 Z M152 230 L120 254 L136 268 L156 238 Z" fill="${o.shirt}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M112 254 L128 254 L132 266 L126 300 L114 300 L108 266 Z" fill="${o.tie}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M112 254 L128 254 L124 266 L116 266 Z" fill="${o.tieKnot || o.tie}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>`;
  } else {
    shirt = `<path d="M86 230 L120 290 L154 230 Z" fill="${o.shirt}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M102 236 L120 268 L138 236 Z" fill="${o.skinShade}"/>
<path d="M86 230 L102 236 L112 262 L94 270 L80 240 Z M154 230 L138 236 L128 262 L146 270 L160 240 Z" fill="${o.shirt}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>`;
  }
  const lapels = `<path d="M84 238 L104 300 L74 300 L62 250 Z M156 238 L136 300 L166 300 L178 250 Z" fill="${o.suit}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>`;
  return neck + jacket + shirt + lapels;
}

const C = {};

// ---------- נתניהו ----------
C.netanyahu = {
  hairShadow: true,
  name: 'נתניהו',
  skin: '#F0BE9A', shade: '#D99A78', light: '#FBDCC4',
  body: { suit: '#1E2A47', suitShade: '#141C33', shirt: '#F6F4EE', tie: '#2F62B8', collar: 'tie' },
  face: 'M120 40 C162 40 186 64 188 102 C190 130 198 158 192 180 C184 208 156 224 120 224 C84 224 56 208 48 180 C42 158 50 130 52 102 C54 64 78 40 120 40 Z',
  ears: [[48, 128, 1.05], [192, 128, 1.05]],
  back: '',
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    // jowls and folds
    s += `<path d="M64 178 C70 196 84 206 98 210" fill="none" stroke="${sh}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M176 178 C170 196 156 206 142 210" fill="none" stroke="${sh}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M92 156 C84 168 84 180 90 190" fill="none" stroke="${sh}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M148 156 C156 168 156 180 150 190" fill="none" stroke="${sh}" stroke-width="3.5" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += eye('n-el', 96, 122, { rx: 13, ry: 10, lid: 0.42, lidColor: sh, iris: '#4A3426', look: 2 });
      s += eye('n-er', 144, 122, { rx: 13, ry: 10, lid: 0.42, lidColor: sh, iris: '#4A3426', look: 2 });
      s += `<path d="M78 104 C88 96 102 96 112 104" fill="none" stroke="#5A5560" stroke-width="7" stroke-linecap="round"/>
<path d="M128 102 C138 94 152 94 164 100" fill="none" stroke="#5A5560" stroke-width="7" stroke-linecap="round"/>`;
    } else {
      s += hitEye(96, 122, 'l') + hitEye(144, 122, 'r');
      s += `<path d="M78 98 C88 86 102 86 112 94" fill="none" stroke="#5A5560" stroke-width="7" stroke-linecap="round"/>
<path d="M128 94 C138 86 152 86 164 96" fill="none" stroke="#5A5560" stroke-width="7" stroke-linecap="round"/>`;
    }
    // big broad nose
    s += `<path d="M116 128 C112 146 104 156 102 164 C100 174 110 178 120 176 C130 178 142 174 140 164 C138 156 130 148 126 130" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M108 166 C110 170 114 170 116 168 M132 168 C134 170 138 170 140 166" fill="none" stroke="${OUT}" stroke-width="3" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += `<path d="M98 192 C108 196 128 196 144 188" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>
<path d="M144 188 C147 186 149 183 149 181" fill="none" stroke="${OUT}" stroke-width="3.5" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 198, 0.9);
    }
    return s;
  },
  hair() {
    const h = '#E3E5EA', hs = '#AEB3BE';
    return `<path d="M48 120 C40 76 60 32 118 26 C170 22 200 56 194 120 C190 104 186 90 182 82 C172 70 156 66 140 70 C124 62 102 62 86 70 C74 72 64 82 58 96 C54 104 50 112 48 120 Z" fill="${h}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M86 70 C98 50 128 42 160 52 C140 50 118 54 104 66 Z" fill="${hs}"/>
<path d="M140 70 C150 58 168 56 182 64 C170 62 156 64 148 72 Z" fill="${hs}"/>
<path d="M70 52 C92 36 130 32 162 40" fill="none" stroke="${hs}" stroke-width="3" stroke-linecap="round"/>
<path d="M60 70 C76 54 100 46 124 46" fill="none" stroke="${hs}" stroke-width="3" stroke-linecap="round"/>
<path d="M54 98 C54 110 54 116 56 122 M186 98 C188 110 188 116 186 122" fill="none" stroke="${hs}" stroke-width="5" stroke-linecap="round"/>`;
  },
  hit: { splat: [112, 70, 0.72, -14] }
};

// ---------- ליברמן ----------
C.liberman = {
  name: 'ליברמן',
  skin: '#EFBB98', shade: '#D49574', light: '#FBDBC6',
  body: { suit: '#2E2F36', suitShade: '#1F2026', shirt: '#EEF0F4', tie: '#7A2232', collar: 'tie' },
  face: 'M120 34 C168 34 194 70 194 116 C194 162 178 206 120 214 C62 206 46 162 46 116 C46 70 72 34 120 34 Z',
  ears: [[46, 128, 1], [194, 128, 1]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    if (st === 'idle') {
      s += eye('l-el', 96, 124, { rx: 11, ry: 7.5, ir: 5.2, lid: 0.35, lidColor: sh, iris: '#4C5A66' });
      s += eye('l-er', 144, 124, { rx: 11, ry: 7.5, ir: 5.2, lid: 0.35, lidColor: sh, iris: '#4C5A66' });
      s += `<path d="M80 108 C90 104 102 106 110 110" fill="none" stroke="#8F8B88" stroke-width="7.5" stroke-linecap="round"/>
<path d="M130 110 C138 106 150 104 160 108" fill="none" stroke="#8F8B88" stroke-width="7.5" stroke-linecap="round"/>`;
    } else {
      s += hitEye(96, 124, 'l') + hitEye(144, 124, 'r');
      s += `<path d="M80 98 C90 90 102 92 110 98" fill="none" stroke="#8F8B88" stroke-width="7.5" stroke-linecap="round"/>
<path d="M130 98 C138 92 150 90 160 98" fill="none" stroke="#8F8B88" stroke-width="7.5" stroke-linecap="round"/>`;
    }
    s += `<path d="M86 136 C92 140 100 140 106 136 M134 136 C140 140 148 140 154 136" fill="none" stroke="${sh}" stroke-width="2.6" stroke-linecap="round"/>`;
    s += `<path d="M118 126 C114 140 108 150 110 158 C114 164 126 164 130 158 C132 150 126 140 122 126" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    return s;
  },
  beard(st) {
    const b = '#C9C6C0', bs = '#9C9893';
    let s = `<path d="M50 132 C52 176 74 222 120 226 C166 222 188 176 190 132 C184 150 176 160 166 164 C156 172 146 170 138 168 L102 168 C94 170 84 172 74 164 C64 160 56 150 50 132 Z" fill="${b}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M62 170 C76 196 96 212 120 216 C102 206 84 192 72 172 Z M178 170 C164 196 144 212 120 216 C138 206 156 192 168 172 Z" fill="${bs}"/>
<g stroke="${bs}" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M90 196 l4 8 M106 204 l2 8 M134 204 l-2 8 M150 196 l-4 8 M120 206 l0 8 M78 182 l4 6 M162 182 l-4 6"/></g>`;
    if (st === 'idle') {
      s += `<path d="M104 184 C112 188 128 188 136 184" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 190, 0.85);
    }
    // moustache
    s += `<path d="M120 164 C108 162 94 166 90 178 C100 176 110 174 120 174 C130 174 140 176 150 178 C146 166 132 162 120 164 Z" fill="${b}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>`;
    return s;
  },
  hair() {
    // bald dome, grey fringe at the sides
    return `<path d="M48 136 C44 112 46 96 52 86 C56 98 58 112 60 128 Z" fill="#B3AFAA" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M192 136 C196 112 194 96 188 86 C184 98 182 112 180 128 Z" fill="#B3AFAA" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
<ellipse cx="98" cy="58" rx="20" ry="9" fill="#FFF2E6" opacity="0.8" transform="rotate(-20 98 58)"/>`;
  },
  hit: { splat: [134, 66, 0.72, 10] }
};

// ---------- איזנקוט ----------
C.eisenkot = {
  hairShadow: true,
  name: 'איזנקוט',
  skin: '#DDA47E', shade: '#BF8462', light: '#EEC6A8',
  body: { suit: '#3A4556', suitShade: '#2A3342', shirt: '#F3F5F8', collar: 'open' },
  face: 'M120 40 C154 40 176 62 178 100 C180 140 176 176 160 200 C148 218 134 226 120 226 C106 226 92 218 80 200 C64 176 60 140 62 100 C64 62 86 40 120 40 Z',
  ears: [[60, 126, 1.25], [180, 126, 1.25]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    s += `<path d="M84 152 C80 166 82 176 86 184 M156 152 C160 166 158 176 154 184" fill="none" stroke="${sh}" stroke-width="3.2" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += eye('e-el', 98, 120, { rx: 11, ry: 9, ir: 5.8, lid: 0.25, lidColor: sh, iris: '#3E2C22', bags: sh });
      s += eye('e-er', 142, 120, { rx: 11, ry: 9, ir: 5.8, lid: 0.25, lidColor: sh, iris: '#3E2C22', bags: sh });
      s += `<path d="M80 104 L112 102" fill="none" stroke="#2E2A2C" stroke-width="7" stroke-linecap="round"/>
<path d="M128 102 L160 104" fill="none" stroke="#2E2A2C" stroke-width="7" stroke-linecap="round"/>`;
    } else {
      s += hitEye(98, 120, 'l') + hitEye(142, 120, 'r');
      s += `<path d="M80 96 C90 88 104 88 112 92" fill="none" stroke="#2E2A2C" stroke-width="7" stroke-linecap="round"/>
<path d="M128 92 C136 88 150 88 160 96" fill="none" stroke="#2E2A2C" stroke-width="7" stroke-linecap="round"/>`;
    }
    // long straight nose
    s += `<path d="M116 118 C116 136 112 150 108 158 C110 166 130 166 132 158 C128 150 124 136 124 118" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += `<path d="M100 188 L140 188" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>
<path d="M108 198 C114 200 126 200 132 198" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 194, 0.85);
    }
    return s;
  },
  hair() {
    const h = '#A6A8AE', hs = '#7D8088';
    return `<path d="M60 112 C56 70 80 34 120 32 C160 34 184 70 180 112 C176 96 172 84 166 76 C150 72 136 74 120 74 C104 74 90 72 74 76 C68 84 64 96 60 112 Z" fill="${h}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<g fill="${hs}"><circle cx="90" cy="54" r="2"/><circle cx="104" cy="46" r="2"/><circle cx="120" cy="44" r="2"/><circle cx="136" cy="46" r="2"/><circle cx="150" cy="54" r="2"/><circle cx="82" cy="66" r="2"/><circle cx="98" cy="62" r="2"/><circle cx="114" cy="58" r="2"/><circle cx="130" cy="58" r="2"/><circle cx="146" cy="62" r="2"/><circle cx="160" cy="66" r="2"/><circle cx="72" cy="88" r="2"/><circle cx="168" cy="88" r="2"/></g>`;
  },
  hit: { splat: [110, 72, 0.7, -8] }
};

// ---------- יאיר גולן ----------
C.golan = {
  name: 'יאיר גולן',
  skin: '#E2A882', shade: '#C38663', light: '#F3CDB2',
  body: { suit: '#27364F', suitShade: '#1B263A', shirt: '#B9D0EA', collar: 'open' },
  face: 'M120 28 C164 28 188 58 188 100 C188 130 186 154 178 176 C170 200 150 218 120 222 C90 218 70 200 62 176 C54 154 52 130 52 100 C52 58 76 28 120 28 Z',
  ears: [[52, 124, 1], [188, 124, 1]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    // shaved scalp shadow + cheekbones + strong jaw lines
    s += `<path d="M60 92 C62 52 88 30 120 30 C152 30 178 52 180 92 C170 70 150 58 120 58 C90 58 70 70 60 92 Z" fill="#9C7B66" opacity="0.35"/>
<path d="M74 150 C82 158 90 160 98 158 M166 150 C158 158 150 160 142 158" fill="none" stroke="${sh}" stroke-width="3.2" stroke-linecap="round"/>
<path d="M68 180 C80 200 100 212 120 214 C140 212 160 200 172 180" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += eye('g-el', 96, 120, { rx: 11.5, ry: 9, ir: 5.8, lid: 0.3, lidColor: sh, iris: '#4E3A2C' });
      s += eye('g-er', 144, 120, { rx: 11.5, ry: 9, ir: 5.8, lid: 0.3, lidColor: sh, iris: '#4E3A2C' });
      s += `<path d="M78 104 C88 98 102 100 112 106" fill="none" stroke="#4A3A32" stroke-width="7.5" stroke-linecap="round"/>
<path d="M128 106 C138 100 152 98 162 104" fill="none" stroke="#4A3A32" stroke-width="7.5" stroke-linecap="round"/>`;
    } else {
      s += hitEye(96, 120, 'l') + hitEye(144, 120, 'r');
      s += `<path d="M78 96 C88 86 102 86 112 92" fill="none" stroke="#4A3A32" stroke-width="7.5" stroke-linecap="round"/>
<path d="M128 92 C138 86 152 86 162 96" fill="none" stroke="#4A3A32" stroke-width="7.5" stroke-linecap="round"/>`;
    }
    s += `<path d="M116 120 C114 138 108 148 106 156 C110 164 130 164 134 156 C132 148 126 138 124 120" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (st === 'idle') {
      // determined half-smile
      s += `<path d="M98 184 C110 190 128 190 142 180" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>
<path d="M142 180 L146 176" stroke="${OUT}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M110 200 C116 203 124 203 130 200" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 190, 0.85);
    }
    return s;
  },
  hair() {
    return `<ellipse cx="100" cy="48" rx="22" ry="9" fill="#FCE3D0" opacity="0.75" transform="rotate(-18 100 48)"/>`;
  },
  hit: { splat: [136, 64, 0.74, 12] }
};

// ---------- בנט ----------
C.bennett = {
  name: 'בנט',
  skin: '#F2C2A0', shade: '#D9A07E', light: '#FDE0CC',
  body: { suit: '#223A66', suitShade: '#182A4C', shirt: '#FFFFFF', collar: 'open' },
  face: 'M120 34 C166 34 190 66 190 110 C190 156 176 204 120 214 C64 204 50 156 50 110 C50 66 74 34 120 34 Z',
  ears: [[50, 126, 1], [190, 126, 1]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    s += `<ellipse cx="78" cy="160" rx="14" ry="9" fill="#EE8E7A" opacity="0.45"/><ellipse cx="162" cy="160" rx="14" ry="9" fill="#EE8E7A" opacity="0.45"/>`;
    if (st === 'idle') {
      s += eye('b-el', 96, 122, { rx: 12, ry: 10.5, ir: 6.2, iris: '#3D7FC0' });
      s += eye('b-er', 144, 122, { rx: 12, ry: 10.5, ir: 6.2, iris: '#3D7FC0' });
      s += `<path d="M80 102 C88 94 102 94 110 100" fill="none" stroke="#5A4434" stroke-width="6.5" stroke-linecap="round"/>
<path d="M130 100 C138 94 152 94 160 102" fill="none" stroke="#5A4434" stroke-width="6.5" stroke-linecap="round"/>`;
    } else {
      s += hitEye(96, 122, 'l') + hitEye(144, 122, 'r');
      s += `<path d="M80 94 C88 84 102 84 110 90" fill="none" stroke="#5A4434" stroke-width="6.5" stroke-linecap="round"/>
<path d="M130 90 C138 84 152 84 160 94" fill="none" stroke="#5A4434" stroke-width="6.5" stroke-linecap="round"/>`;
    }
    // short upturned nose
    s += `<path d="M118 126 C114 138 108 146 110 152 C114 158 126 158 130 152 C132 146 126 138 122 126" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (st === 'idle') {
      // big toothy grin
      s += `<path d="M84 170 C96 200 144 200 156 170 C140 178 100 178 84 170 Z" fill="#6E1E28" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M90 174 C102 178 138 178 150 174 L148 182 C134 186 106 186 92 182 Z" fill="#FFFDF8"/>
<path d="M84 170 C96 200 144 200 156 170" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>
<path d="M80 166 C78 170 80 174 84 176 M160 166 C162 170 160 174 156 176" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 182, 0.9);
    }
    return s;
  },
  hair() {
    const h = '#4E3A2E', hs = '#3A2B22';
    // bald top, dark short hair round the sides, small kippah at the crown
    return `<path d="M50 128 C44 104 46 80 58 64 C62 82 62 100 64 122 Z" fill="${h}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M190 128 C196 104 194 80 182 64 C178 82 178 100 176 122 Z" fill="${h}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
<ellipse cx="102" cy="56" rx="20" ry="8" fill="#FFF0E4" opacity="0.8" transform="rotate(-20 102 56)"/>
<g transform="rotate(14 150 40)"><path d="M120 46 C122 22 178 22 180 46 C160 40 140 40 120 46 Z" fill="#2B3550" stroke="${OUT}" stroke-width="4" stroke-linejoin="round"/>
<path d="M128 38 C142 33 158 33 172 38" fill="none" stroke="#8FA6D6" stroke-width="2.6"/>
<path d="M134 31 C144 28 156 28 166 31" fill="none" stroke="#8FA6D6" stroke-width="2" stroke-dasharray="3 3"/></g>`;
  },
  hit: { splat: [110, 66, 0.72, -10] }
};

// ---------- בן גביר ----------
C.bengvir = {
  hairShadow: true,
  name: 'בן גביר',
  skin: '#DEA27C', shade: '#C0825E', light: '#EFC6A8',
  body: { suit: '#2B2E38', suitShade: '#1D1F27', shirt: '#FFFFFF', collar: 'open' },
  face: 'M120 40 C164 40 192 68 194 110 C196 156 180 204 120 214 C60 204 44 156 46 110 C48 68 76 40 120 40 Z',
  ears: [[46, 124, 0.95], [194, 124, 0.95]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    // stubble along the jaw, chubby cheeks
    s += `<path d="M52 140 C56 180 82 210 120 214 C158 210 184 180 188 140 C178 168 160 188 120 190 C80 188 62 168 52 140 Z" fill="#3B2A22" opacity="0.28"/>
<ellipse cx="74" cy="158" rx="16" ry="10" fill="#E9806A" opacity="0.35"/><ellipse cx="166" cy="158" rx="16" ry="10" fill="#E9806A" opacity="0.35"/>`;
    if (st === 'idle') {
      s += eye('bg-el', 94, 122, { rx: 11, ry: 9.5, ir: 6, iris: '#3B2A22', look: -1 });
      s += eye('bg-er', 146, 122, { rx: 11, ry: 9.5, ir: 6, iris: '#3B2A22', look: -1 });
      s += `<path d="M76 98 C86 92 100 92 110 98" fill="none" stroke="#2A1F1A" stroke-width="7" stroke-linecap="round"/>
<path d="M130 98 C140 92 154 92 164 98" fill="none" stroke="#2A1F1A" stroke-width="7" stroke-linecap="round"/>`;
    } else {
      s += hitEye(94, 122, 'l') + hitEye(146, 122, 'r');
      s += `<path d="M76 90 C86 80 100 80 110 88" fill="none" stroke="#2A1F1A" stroke-width="7" stroke-linecap="round"/>
<path d="M130 88 C140 80 154 80 164 90" fill="none" stroke="#2A1F1A" stroke-width="7" stroke-linecap="round"/>`;
    }
    s += `<path d="M116 124 C112 138 106 148 106 156 C110 164 130 164 134 156 C134 148 128 138 124 124" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (st === 'idle') {
      // wide grin
      s += `<path d="M88 176 C100 198 140 198 152 176 C136 182 104 182 88 176 Z" fill="#6E1E28" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M94 179 C106 183 134 183 146 179 L144 186 C132 189 108 189 96 186 Z" fill="#FFFDF8"/>
<path d="M88 176 C100 198 140 198 152 176" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 186, 0.9);
    }
    return s;
  },
  hair() {
    const h = '#2A201C';
    return `<path d="M48 116 C42 72 70 38 120 36 C170 38 198 72 192 116 C188 98 182 84 174 76 C160 74 150 70 140 62 C128 70 112 72 96 70 C82 70 72 76 66 84 C56 94 52 104 48 116 Z" fill="${h}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>`;
  },
  extras(st) {
    // rectangular glasses then a big knitted kippah
    let s = `<g fill="#FFFFFF" fill-opacity="0.12" stroke="#15121A" stroke-width="4.5" stroke-linejoin="round">
<rect x="74" y="108" width="40" height="28" rx="7"/><rect x="126" y="108" width="40" height="28" rx="7"/></g>
<path d="M114 118 C118 114 122 114 126 118 M74 116 L52 112 M166 116 L188 112" fill="none" stroke="#15121A" stroke-width="4.5" stroke-linecap="round"/>
<path d="M80 114 L92 114" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/><path d="M132 114 L144 114" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>`;
    s += `<path d="M70 52 C74 18 166 18 170 52 C140 42 100 42 70 52 Z" fill="#F4F1EA" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M80 44 C102 36 138 36 160 44" fill="none" stroke="#2F5DAE" stroke-width="3.5"/>
<path d="M90 34 C108 28 132 28 150 34" fill="none" stroke="#C9341C" stroke-width="3"/>
<g fill="#2F5DAE"><circle cx="96" cy="40" r="2"/><circle cx="110" cy="38" r="2"/><circle cx="124" cy="37" r="2"/><circle cx="138" cy="38" r="2"/><circle cx="150" cy="40" r="2"/></g>`;
    return s;
  },
  hit: { splat: [132, 66, 0.7, 8] }
};

// ---------- סמוטריץ' ----------
C.smotrich = {
  hairShadow: true,
  name: 'סמוטריץ׳',
  skin: '#EBB592', shade: '#CD9270', light: '#F9D6BE',
  body: { suit: '#25262E', suitShade: '#18191F', shirt: '#FFFFFF', collar: 'open' },
  face: 'M120 36 C158 36 182 62 182 104 C182 146 172 196 120 216 C68 196 58 146 58 104 C58 62 82 36 120 36 Z',
  ears: [[58, 124, 1], [182, 124, 1]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    if (st === 'idle') {
      s += eye('s-el', 98, 118, { rx: 11, ry: 9, ir: 6, iris: '#2E2420', lid: 0.18, lidColor: sh });
      s += eye('s-er', 142, 118, { rx: 11, ry: 9, ir: 6, iris: '#2E2420', lid: 0.18, lidColor: sh });
      s += `<path d="M80 100 C90 98 102 100 112 106" fill="none" stroke="#1E1816" stroke-width="7" stroke-linecap="round"/>
<path d="M128 106 C138 100 150 98 160 100" fill="none" stroke="#1E1816" stroke-width="7" stroke-linecap="round"/>`;
    } else {
      s += hitEye(98, 118, 'l') + hitEye(142, 118, 'r');
      s += `<path d="M80 92 C90 84 102 84 112 90" fill="none" stroke="#1E1816" stroke-width="7" stroke-linecap="round"/>
<path d="M128 90 C138 84 150 84 160 92" fill="none" stroke="#1E1816" stroke-width="7" stroke-linecap="round"/>`;
    }
    s += `<path d="M116 120 C114 136 108 146 108 154 C112 160 128 160 132 154 C132 146 126 136 124 120" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    return s;
  },
  beard(st) {
    const b = '#2A2220', bs = '#5E5450';
    let s = `<path d="M58 118 C56 170 74 232 120 246 C166 232 184 170 182 118 C178 140 170 152 160 156 C150 164 140 164 132 162 L108 162 C100 164 90 164 80 156 C70 152 62 140 58 118 Z" fill="${b}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<g fill="none" stroke="${bs}" stroke-width="2.6" stroke-linecap="round"><path d="M84 192 C88 206 96 218 104 226 M156 192 C152 206 144 218 136 226 M120 204 L120 236 M72 168 C74 180 78 188 82 196 M168 168 C166 180 162 188 158 196"/></g>`;
    if (st === 'idle') {
      s += `<path d="M106 180 C112 183 128 183 134 180" fill="none" stroke="#C9A69A" stroke-width="4" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 184, 0.85);
    }
    s += `<path d="M120 158 C106 156 94 162 90 174 C100 170 110 170 120 170 C130 170 140 170 150 174 C146 162 134 156 120 158 Z" fill="${b}" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>`;
    return s;
  },
  hair() {
    const h = '#2A2220';
    return `<path d="M58 112 C52 68 78 34 120 32 C162 34 188 68 182 112 C178 92 170 80 160 72 C146 68 132 68 120 70 C104 66 90 68 80 72 C68 80 62 94 58 112 Z" fill="${h}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>`;
  },
  extras() {
    // medium knitted kippah, dark with a coloured band
    return `<path d="M78 44 C82 12 158 12 162 44 C136 36 104 36 78 44 Z" fill="#33384C" stroke="${OUT}" stroke-width="4" stroke-linejoin="round"/>
<path d="M86 36 C106 28 134 28 154 36" fill="none" stroke="#E0B85A" stroke-width="3.5"/>
<path d="M96 25 C110 20 130 20 144 25" fill="none" stroke="#E0B85A" stroke-width="2.4" stroke-dasharray="4 3"/>`;
  },
  hit: { splat: [108, 70, 0.7, -12] }
};

// ---------- לפיד ----------
C.lapid = {
  hairShadow: true,
  name: 'לפיד',
  skin: '#D9996F', shade: '#BA7A52', light: '#ECBB98',
  body: { suit: '#1A1A1E', suitShade: '#0E0E11', shirt: '#2A2A30', collar: 'open', skinShadeOverride: true },
  face: 'M120 46 C160 46 184 72 184 110 C184 146 180 178 168 198 C156 216 138 224 120 224 C102 224 84 216 72 198 C60 178 56 146 56 110 C56 72 80 46 120 46 Z',
  ears: [[56, 128, 1], [184, 128, 1]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    s += `<path d="M72 188 C84 206 102 216 120 218 C138 216 156 206 168 188" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += eye('lp-el', 98, 124, { rx: 11.5, ry: 8.5, ir: 5.8, lid: 0.32, lidColor: sh, iris: '#3A2A20' });
      s += eye('lp-er', 142, 124, { rx: 11.5, ry: 8.5, ir: 5.8, lid: 0.32, lidColor: sh, iris: '#3A2A20' });
      s += `<path d="M80 106 C90 100 102 100 112 104" fill="none" stroke="#3E3536" stroke-width="7" stroke-linecap="round"/>
<path d="M128 104 C138 100 150 100 160 106" fill="none" stroke="#3E3536" stroke-width="7" stroke-linecap="round"/>`;
    } else {
      s += hitEye(98, 124, 'l') + hitEye(142, 124, 'r');
      s += `<path d="M80 96 C90 88 102 88 112 94" fill="none" stroke="#3E3536" stroke-width="7" stroke-linecap="round"/>
<path d="M128 94 C138 88 150 88 160 96" fill="none" stroke="#3E3536" stroke-width="7" stroke-linecap="round"/>`;
    }
    s += `<path d="M116 126 C114 140 108 150 108 158 C112 164 128 164 132 158 C132 150 126 140 124 126" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (st === 'idle') {
      // confident closed smile with a dimple
      s += `<path d="M96 184 C108 194 132 194 144 184" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>
<path d="M92 180 C92 184 94 186 96 186 M148 180 C148 184 146 186 144 186" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 190, 0.85);
    }
    return s;
  },
  hair() {
    const h = '#EEEFF2', hs = '#B9BCC4';
    // tall swept-back silver mane
    return `<path d="M56 122 C46 82 52 34 98 14 C126 4 168 10 186 36 C196 54 194 92 184 122 C180 104 176 92 170 84 C160 70 146 64 130 66 C114 62 96 64 84 70 C72 80 64 96 56 122 Z" fill="${h}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M84 70 C92 46 120 30 156 32 C130 40 110 52 100 68 Z" fill="${hs}"/>
<path d="M130 66 C140 48 160 42 178 46 C164 52 152 58 146 68 Z" fill="${hs}"/>
<path d="M70 46 C90 24 126 16 160 22 M62 72 C78 46 104 34 132 32" fill="none" stroke="${hs}" stroke-width="3" stroke-linecap="round"/>`;
  },
  hit: { splat: [134, 72, 0.72, 14] }
};

// ---------- גנץ ----------
C.gantz = {
  hairShadow: true,
  name: 'גנץ',
  skin: '#F0BFA0', shade: '#D49C7C', light: '#FCDCC8',
  body: { suit: '#243559', suitShade: '#182644', shirt: '#F6F7FA', tie: '#7FB2E5', tieKnot: '#6C9FD3', collar: 'tie' },
  // long face with a big square chin
  face: 'M120 34 C160 34 184 58 186 98 C188 134 190 168 184 194 C180 218 160 234 120 236 C80 234 60 218 56 194 C50 168 52 134 54 98 C56 58 80 34 120 34 Z',
  ears: [[54, 122, 1], [186, 122, 1]],
  features(st) {
    const sk = this.skin, sh = this.shade;
    let s = '';
    s += `<path d="M96 224 C110 230 130 230 144 224" fill="none" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>
<path d="M120 214 L120 226" stroke="${sh}" stroke-width="3" stroke-linecap="round"/>`;
    if (st === 'idle') {
      s += eye('gz-el', 96, 118, { rx: 12, ry: 10, ir: 6.2, iris: '#5D9AD6', lid: 0.15, lidColor: sh });
      s += eye('gz-er', 144, 118, { rx: 12, ry: 10, ir: 6.2, iris: '#5D9AD6', lid: 0.15, lidColor: sh });
      s += `<path d="M78 100 C88 94 102 94 112 98" fill="none" stroke="#6A6670" stroke-width="6.5" stroke-linecap="round"/>
<path d="M128 98 C138 94 152 94 162 100" fill="none" stroke="#6A6670" stroke-width="6.5" stroke-linecap="round"/>`;
    } else {
      s += hitEye(96, 118, 'l') + hitEye(144, 118, 'r');
      s += `<path d="M78 92 C88 82 102 82 112 88" fill="none" stroke="#6A6670" stroke-width="6.5" stroke-linecap="round"/>
<path d="M128 88 C138 82 152 82 162 92" fill="none" stroke="#6A6670" stroke-width="6.5" stroke-linecap="round"/>`;
    }
    s += `<path d="M116 120 C114 136 108 146 108 154 C112 160 128 160 132 154 C132 146 126 136 124 120" fill="${sk}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (st === 'idle') {
      // wide, slightly awkward smile
      s += `<path d="M88 178 C102 190 138 190 152 178" fill="none" stroke="${OUT}" stroke-width="${SW}" stroke-linecap="round"/>
<path d="M86 174 L90 180 M154 174 L150 180" stroke="${OUT}" stroke-width="3.5" stroke-linecap="round"/>`;
    } else {
      s += hitMouth(120, 186, 0.9);
    }
    return s;
  },
  hair() {
    const h = '#9C9EA6', hs = '#7A7C84';
    // neat short grey hair, side part
    return `<path d="M54 110 C48 66 76 26 122 26 C168 26 194 64 186 110 C182 92 178 80 172 72 C158 64 140 62 124 64 L108 52 C96 60 82 64 72 70 C64 80 58 94 54 110 Z" fill="${h}" stroke="${OUT}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="M108 52 C120 40 150 38 170 48 C150 46 130 48 120 58 Z" fill="${hs}"/>
<path d="M104 48 C94 40 80 42 70 50" fill="none" stroke="${hs}" stroke-width="3" stroke-linecap="round"/>`;
  },
  hit: { splat: [110, 66, 0.72, -6] }
};

function build(id, st) {
  const c = C[id];
  const b = Object.assign({ skinShade: c.shade }, c.body);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" width="240" height="300">`;
  s += body(b);
  s += c.back || '';
  for (const [x, y, sc] of c.ears) s += ear(x, y, c.skin, c.shade, x > 120, sc);
  s += faceBlock(id, c.face, c.skin, c.shade, c.light);
  if (c.hairShadow) {
    s += `<filter id="${id}-hs"><feFlood flood-color="${c.shade}"/><feComposite in2="SourceAlpha" operator="in"/></filter>
<g clip-path="url(#${id}-fc)"><g transform="translate(3 8)" filter="url(#${id}-hs)">${c.hair(st)}</g></g>`;
  }
  s += faceOutline(c.face);
  s += c.features(st);
  if (c.beard) s += c.beard(st);
  s += c.hair(st);
  if (c.extras) s += c.extras(st);
  if (st === 'hit') s += splat(...c.hit.splat);
  s += `</svg>`;
  return s;
}

const outDir = __dirname;
fs.mkdirSync(outDir, { recursive: true });
const ids = Object.keys(C);
for (const id of ids) {
  for (const st of ['idle', 'hit']) fs.writeFileSync(path.join(outDir, `${id}-${st}.svg`), build(id, st));
}
fs.writeFileSync(path.join(outDir, 'cast.json'), JSON.stringify(ids.map((id) => ({ id, name: C[id].name })), null, 1));
console.log('wrote', ids.length * 2, 'svgs');
