import './globals.css';

export const metadata = {
  title: 'SSL Monitoring',
  description: 'Monitoring sertifikat SSL dari Source of Truth (Excel)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
