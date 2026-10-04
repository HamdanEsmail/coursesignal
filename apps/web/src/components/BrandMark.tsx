type BrandMarkProps = {
  href?: string;
};

export function BrandMark({ href = "/#arrive" }: BrandMarkProps) {
  return (
    <a className="brand-mark" href={href}>
      <picture>
        <source srcSet="/logo.webp" type="image/webp" />
        <img className="brand-mark__asset" src="/logo.png" alt="" width="36" height="36" decoding="async" />
      </picture>
      <span className="brand-mark__word">Lodge</span>
    </a>
  );
}
