// Quire's mark: three folded sheets nested inside one another, seen end-on
// from the fold — which is what a quire is, the gathering of leaves that makes
// one signature of a book. Arcs rather than chevrons: chevrons converge to a
// point and the three strokes merge into a single arrow at sidebar size.
export function QuireMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} role="img" aria-label="Quire">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="5.2"
        strokeLinecap="round"
      >
        <path d="M26.5 41.5 A23.5 23.5 0 0 0 73.5 41.5" />
        <path d="M34.5 41.5 A15.5 15.5 0 0 0 65.5 41.5" />
        <path d="M42.5 41.5 A7.5 7.5 0 0 0 57.5 41.5" />
      </g>
    </svg>
  );
}
