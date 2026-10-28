// Hand-built SVG illustration for the login screen: dotted world map, flight
// paths, books with a graduation cap, a globe, a passport and a plant.

// Rough continent blobs (cx, cy, rx, ry) used to mask the dot grid.
const blobs: [number, number, number, number][] = [
  [150, 95, 85, 45], [205, 150, 40, 28], [235, 235, 38, 62], [395, 85, 55, 30], [420, 190, 55, 70],
  [540, 95, 120, 48], [600, 160, 55, 35], [690, 255, 52, 30], [470, 135, 30, 25],
];
const dots: [number, number][] = [];
for (let y = 40; y < 320; y += 11) {
  for (let x = 60; x < 770; x += 11) {
    if (blobs.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1)) dots.push([x, y]);
  }
}

function Pin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="18" rx="6" ry="2" className="fill-[#06242F] dark:fill-[#1F4B5B]" opacity=".12" />
      <path d="M0 18 C-9 6 -10 0 -10 -4 a10 10 0 0 1 20 0 c0 4 -1 10 -10 22z" fill="#B94A12" />
      <circle cx="0" cy="-4" r="3.6" fill="#fff" />
    </g>
  );
}

export function EducationIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 470" className={className} role="img" aria-label="Students travelling the world for education">
      <defs>
        <radialGradient id="globeG" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFF5E6" />
          <stop offset="70%" stopColor="#F9DDB3" />
          <stop offset="100%" stopColor="#EFC48A" />
        </radialGradient>
        <linearGradient id="bookA" x1="0" x2="1">
          <stop offset="0" stopColor="#C9581B" />
          <stop offset="1" stopColor="#E0782E" />
        </linearGradient>
        <linearGradient id="passG" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#0D2E3A" className="dark:[stop-color:#24566A]" />
          <stop offset="1" stopColor="#06242F" className="dark:[stop-color:#1F4B5B]" />
        </linearGradient>
      </defs>

      {/* dotted world map */}
      <g fill="#F4B76A" opacity=".42">
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.1" />
        ))}
      </g>

      {/* flight paths */}
      <g fill="none" stroke="#C9733A" strokeWidth="1.6" strokeDasharray="5 6" opacity=".7">
        <path d="M175 175 Q 260 90 345 140" className="animate-dash" />
        <path d="M345 140 Q 470 30 610 70" className="animate-dash" />
        <path d="M345 140 Q 470 110 560 190" className="animate-dash" />
        <path d="M610 70 Q 690 90 700 130" className="animate-dash" />
        <path d="M150 360 Q 170 250 230 200" className="animate-dash" />
      </g>
      <Pin x={175} y={170} />
      <Pin x={345} y={134} />
      <Pin x={560} y={185} />
      <Pin x={700} y={126} />
      {/* Outer group positions the plane; inner group floats (a CSS transform would replace the SVG one). */}
      <g transform="translate(482 62) rotate(-12)">
        <g className="animate-float">
          <path d="M-18 0 L14 -2 Q22 0 14 2 L-18 0z M-4 -1 L-12 -12 L-6 -12 L6 -1z M-4 1 L-12 12 L-6 12 L6 1z M-16 0 L-20 -6 L-17 -6 L-12 0z" fill="#B94A12" />
        </g>
      </g>

      {/* ground shadow */}
      <ellipse cx="420" cy="452" rx="330" ry="14" className="fill-[#06242F] dark:fill-black" opacity=".08" />

      {/* books + cap */}
      <g transform="translate(110 300)">
        <rect x="0" y="92" width="240" height="56" rx="8" className="fill-[#06242F] dark:fill-[#1F4B5B]" />
        <rect x="10" y="98" width="222" height="40" rx="5" className="fill-[#FBF6EE] dark:fill-[#E9E1D3]" />
        <path d="M10 108h222M10 118h222M10 128h222" stroke="#E7DCCB" strokeWidth="1.5" />
        <rect x="18" y="40" width="210" height="54" rx="8" fill="url(#bookA)" />
        <rect x="26" y="46" width="194" height="38" rx="5" className="fill-[#FBF6EE] dark:fill-[#E9E1D3]" />
        <path d="M26 56h194M26 66h194M26 76h194" stroke="#E7DCCB" strokeWidth="1.5" />
        <rect x="18" y="84" width="210" height="10" rx="3" fill="#A9461A" />
        {/* cap */}
        <path d="M60 30 Q122 50 184 30 L184 -2 Q122 10 60 -2z" className="fill-[#0D2E3A] dark:fill-[#24566A]" />
        <path d="M122 -42 L230 -14 L122 14 L14 -14z" className="fill-[#123B4A] dark:fill-[#2B6378]" />
        <path d="M122 -42 L230 -14 L122 14 L14 -14z" fill="none" stroke="#1E4A5A" strokeWidth="1.5" />
        <circle cx="122" cy="-14" r="4.5" fill="#FBA51E" />
        <path d="M122 -14 Q180 -4 196 18 L196 52" stroke="#FBA51E" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <rect x="190" y="48" width="12" height="22" rx="4" fill="#E59416" />
      </g>

      {/* globe */}
      <g transform="translate(470 270)">
        <path d="M-10 160 h40 l8 18 h-56z" className="fill-[#06242F] dark:fill-[#1F4B5B]" />
        <rect x="6" y="110" width="8" height="52" className="fill-[#0D2E3A] dark:fill-[#24566A]" />
        <path d="M78 -66 A105 105 0 0 1 32 116" className="stroke-[#0D2E3A] dark:stroke-[#24566A]" strokeWidth="9" fill="none" strokeLinecap="round" />
        <circle cx="10" cy="20" r="92" fill="url(#globeG)" />
        <path
          d="M-50 -30 q20 -20 50 -12 q18 6 10 22 q-12 18 4 30 q14 10 -4 26 q-20 14 -26 40 q-14 -16 -16 -36 q-2 -20 -22 -24 q-16 -6 -8 -24z M30 -50 q30 -10 48 14 q8 16 -8 22 q-20 2 -26 -10 q-10 -14 -14 -26z M50 30 q24 -4 30 16 q4 22 -16 30 q-18 -6 -20 -22z"
          fill="#E0904A"
          opacity=".85"
        />
        <ellipse cx="-20" cy="-28" rx="34" ry="18" fill="#fff" opacity=".35" />
      </g>

      {/* passport + ticket */}
      <g transform="translate(600 330) rotate(9)">
        <rect x="28" y="-40" width="56" height="100" rx="5" fill="#FBA51E" transform="rotate(12 56 10)" />
        <rect x="36" y="-30" width="40" height="5" rx="2" fill="#fff" opacity=".7" transform="rotate(12 56 10)" />
        <rect x="0" y="0" width="104" height="134" rx="9" fill="url(#passG)" />
        <circle cx="52" cy="54" r="22" fill="none" stroke="#E9B44C" strokeWidth="2.5" />
        <path d="M30 54h44M52 32v44M38 40q14 14 28 0M38 68q14 -14 28 0" stroke="#E9B44C" strokeWidth="1.8" fill="none" />
        <text x="52" y="106" textAnchor="middle" fontSize="11" letterSpacing="2" fill="#E9B44C" fontFamily="Lexend, sans-serif">
          PASSPORT
        </text>
      </g>

      {/* plant */}
      <g transform="translate(730 300)">
        <path d="M-26 98 h52 l-6 52 h-40z" className="fill-white stroke-[#E9E4DA] dark:fill-[#E9E1D3] dark:stroke-transparent" strokeWidth="2" />
        <path d="M0 98 C-2 60 -4 40 -20 10" stroke="#4E7A50" strokeWidth="3" fill="none" />
        <path d="M0 98 C4 60 10 30 26 4" stroke="#4E7A50" strokeWidth="3" fill="none" />
        <path d="M-20 10 C-48 0 -46 -30 -30 -40 C-14 -26 -12 -4 -20 10z" fill="#6E9B67" />
        <path d="M26 4 C50 -8 58 -40 40 -54 C22 -38 18 -14 26 4z" fill="#5D8C58" />
        <path d="M-2 60 C-30 58 -40 36 -34 26 C-16 30 -6 44 -2 60z" fill="#7FAA77" />
        <path d="M4 50 C28 44 36 22 30 12 C12 18 4 34 4 50z" fill="#6E9B67" />
      </g>
    </svg>
  );
}
