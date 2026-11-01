'use client';
// Kucing hidup: kepala menoleh, mata berkedip, ekor bergoyang, tangan bergerak.
// Gambar tetap utuh (tidak dipotong); bagian tubuh adalah salinan gambar yang ditampilkan lewat
// masker lembut lalu digerakkan sedikit di sekitar titik sendinya.
// mata   = [kiri, atas, lebar, tinggi] dalam persen
// bagian = [jenis, pusatX, pusatY, radiusX, radiusY, sendiX, sendiY] dalam persen
export const KUCING = {
  dashboard: { src: '/art/adegan/dashboard.webp', rasio: '1033 / 420', mata: [[66.60, 46.43, 6.00, 12.86], [75.41, 45.71, 4.45, 12.38]], bagian: [['kepala', 71.15, 40.48, 13.07, 30.48, 71.64, 67.86]] },
  inventory: { src: '/art/adegan/inventory.webp', rasio: '918 / 420', mata: [[69.06, 40.24, 6.32, 12.38], [78.32, 40.00, 5.23, 11.43]], bagian: [['kepala', 74.62, 40.48, 13.29, 26.67, 75.16, 63.81], ['ekor', 55.56, 76.19, 7.84, 26.67, 61.0, 96.43], ['tangan', 78.65, 76.67, 4.58, 10.0, 76.25, 84.52]] },
  excel: { src: '/art/adegan/excel.webp', rasio: '994 / 420', mata: [[70.02, 46.90, 5.63, 11.90], [82.29, 47.14, 4.83, 11.43]], bagian: [['kepala', 76.46, 42.86, 14.29, 29.05, 76.46, 67.86], ['ekor', 56.34, 78.57, 6.04, 19.05, 61.37, 96.43]] },
  jobs: { src: '/art/adegan/jobs.webp', rasio: '724 / 420', mata: [], bagian: [['kepala', 69.06, 33.33, 18.23, 26.67, 69.06, 58.33], ['tangan-lambai', 42.82, 33.33, 6.63, 14.76, 46.96, 53.57]] },
  audit: { src: '/art/adegan/audit.webp', rasio: '926 / 420', mata: [[67.39, 36.43, 5.18, 10.48], [75.59, 34.76, 5.62, 11.43]], bagian: [['kepala', 75.59, 35.71, 13.17, 29.05, 75.59, 60.71], ['ekor', 92.87, 66.67, 7.78, 29.05, 89.63, 91.67]] },
  health: { src: '/art/adegan/health.webp', rasio: '930 / 420', mata: [[71.40, 41.90, 6.24, 11.43]], bagian: [['kepala', 74.19, 40.48, 13.12, 27.62, 74.19, 63.1], ['ekor', 50.54, 76.19, 8.82, 21.9, 60.22, 91.67], ['tangan', 78.49, 88.57, 4.84, 9.52, 75.27, 93.33]] },
  users: { src: '/art/adegan/users.webp', rasio: '929 / 420', mata: [[65.23, 41.19, 4.74, 10.48], [74.70, 34.76, 6.24, 12.38]], bagian: [['kepala', 75.35, 38.1, 13.13, 29.05, 75.35, 60.71], ['ekor', 94.73, 64.29, 7.75, 26.67, 91.5, 89.29]] },
  settings: { src: '/art/adegan/settings.webp', rasio: '859 / 420', mata: [[72.06, 42.14, 6.75, 12.38], [82.19, 45.00, 5.12, 11.43]], bagian: [['kepala', 72.18, 42.86, 15.37, 31.43, 73.34, 67.86], ['tangan', 88.71, 76.19, 6.05, 10.95, 83.82, 81.43]] },
  login: { src: '/art/login-kucing.jpg', rasio: '695 / 720', mata: [[51.08, 41.32, 8.63, 7.64], [65.76, 43.06, 6.62, 6.94]], bagian: [['kepala', 58.99, 43.06, 17.55, 15.56, 58.99, 56.25], ['ekor', 28.78, 65.28, 11.22, 18.33, 36.69, 81.94]] },
};

export default function KucingHidup({ id, className = '' }) {
  const k = KUCING[id];
  if (!k) return null;
  const tunda = `${(id.length % 4) * 0.7}s`;
  const kelopak = k.mata.map(([l, t, w, h], i) => (
    <i key={i} className="kelopak" style={{ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, animationDelay: tunda }} />
  ));
  const adaKepala = k.bagian.some((b) => b[0] === 'kepala');
  return (
    <div className={`kucing-hidup ${className}`} style={{ aspectRatio: k.rasio }} aria-hidden="true">
      <img src={k.src} alt="" />
      {k.bagian.map(([jenis, cx, cy, rx, ry, px, py], i) => {
        const masker = `radial-gradient(ellipse ${rx}% ${ry}% at ${cx}% ${cy}%, #000 62%, transparent 100%)`;
        return (
          <div key={i} className={`bagian ${jenis}`} style={{ WebkitMaskImage: masker, maskImage: masker, transformOrigin: `${px}% ${py}%`, animationDelay: `-${i * 0.9}s` }}>
            <img src={k.src} alt="" />
            {jenis === 'kepala' && kelopak}
          </div>
        );
      })}
      {!adaKepala && kelopak}
    </div>
  );
}
