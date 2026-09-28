import './globals.css';
export const metadata = { title: 'HEVC Studio', description: 'Browser H.265 streaming laboratory' };
export default function Layout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
