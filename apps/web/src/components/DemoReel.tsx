export function DemoReel() {
  return (
    <figure className="device">
      <picture>
        <source srcSet="/poster.webp" type="image/webp" />
        <img
          className="device__film"
          src="/poster.jpg"
          alt=""
          width="390"
          height="700"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <figcaption>
        See it on iMessage. A short portrait recording of Hamdan texting Lodge belongs in this frame.
      </figcaption>
    </figure>
  );
}
