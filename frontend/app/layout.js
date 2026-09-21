import './globals.css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AdScripts from '../components/AdScripts';

export const metadata = {
  title: 'EGYMAX | بوابة المشاهدة الأولى للأفلام والمسلسلات الحصرية',
  description: 'شاهد وحمل أحدث الأفلام والمسلسلات العربية والأجنبية المترجمة بجودة 4K و 1080p مجاناً على سيرفرات سريعة وبدون إعلانات مزعجة.',
  keywords: 'ايجي ماكس, EGYMAX, افلام 2026, افلام مترجمة, مشاهدة افلام اون لاين, افلام عربي, افلام اكشن, افلام نتفلكس',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <AdScripts />
        <Navbar />
        <main className="main-content">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
