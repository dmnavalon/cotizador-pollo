import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cotizador Pechuga de Pollo',
  description: 'Mejor precio mayorista de pechuga de pollo deshuesada en Chile',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f8fa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
