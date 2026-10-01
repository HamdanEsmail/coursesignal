type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className="brand-mark" aria-label="CourseSignal">
      <svg
        className="brand-mark__glyph"
        viewBox="0 0 48 32"
        role="img"
        aria-hidden="true"
      >
        <path d="M3 24.5C10 24.5 11 7 18 7s5 18 12 18S34 8 45 8" />
      </svg>
      {compact ? null : <span>CourseSignal</span>}
    </div>
  );
}
