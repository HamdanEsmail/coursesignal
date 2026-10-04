type BrandMarkProps = {
  href?: string;
};

export function BrandMark({ href = "#arrive" }: BrandMarkProps) {
  return (
    <a className="brand-mark" href={href}>
      <svg className="brand-mark__key" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="11" cy="12" r="5.2" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path
          d="M15.6 14.6 26 25.2v3.2h-3.4l-1.6-1.6 1.5-1.6-1.7-1.5 1.5-1.6-2.4-2.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Lodge</span>
    </a>
  );
}
