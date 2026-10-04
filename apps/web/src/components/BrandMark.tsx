import { useState } from "react";

type BrandMarkProps = {
  href?: string;
};

export function BrandMark({ href = "/#arrive" }: BrandMarkProps) {
  const [src, setSrc] = useState("/logo.png");

  return (
    <a className="brand-mark" href={href}>
      <img
        className="brand-mark__asset"
        src={src}
        alt=""
        onError={() => {
          setSrc((current) => (current === "/logo.png" ? "/logo.svg" : current));
        }}
      />
      <span className="brand-mark__word">Lodge</span>
    </a>
  );
}
