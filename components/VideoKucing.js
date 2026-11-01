'use client';
import { useEffect, useRef } from 'react';

/**
 * Video animasi kucing (berputar terus, tanpa suara). Video dibuat dari gambar kucing tiap fitur,
 * sudah dirapikan: watermark dihapus, kamera distabilkan, dan ujungnya disambung supaya loop mulus.
 * File: public/video/<id>.mp4 + poster public/video/<id>.jpg
 */
export default function VideoKucing({ id, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // wajib untuk autoplay di HP (iOS/Android)
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }, [id]);
  return (
    <video ref={ref} key={id} className={className} src={`/video/${id}.mp4`} poster={`/video/${id}.jpg`}
      autoPlay muted loop playsInline preload="auto" disablePictureInPicture aria-hidden="true" />
  );
}
