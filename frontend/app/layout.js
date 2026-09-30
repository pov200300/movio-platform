import './globals.css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AdScripts from '../components/AdScripts';
import { GoogleAnalytics } from '@next/third-parties/google';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
  .replace(/^http:\/\//i, 'https://')
  .replace(/\/+$/, '');

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'EGYMAX | بوابة المشاهدة الأولى للأفلام والمسلسلات الحصرية',
    template: '%s',
  },
  description: 'شاهد وحمل أحدث الأفلام والمسلسلات العربية والأجنبية المترجمة بجودة 4K و 1080p مجاناً على سيرفرات سريعة وبدون إعلانات مزعجة على EgyMax.',
  keywords: [
    'ايجي ماكس',
    'EGYMAX',
    'افلام 2026',
    'افلام مترجمة',
    'مشاهدة افلام اون لاين',
    'افلام عربي',
    'افلام اكشن',
    'افلام نتفلكس',
    'مسلسلات مترجمة',
  ],
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'EGYMAX | بوابة المشاهدة الأولى للأفلام والمسلسلات الحصرية',
    description: 'شاهد وحمل أحدث الأفلام والمسلسلات العربية والأجنبية المترجمة بجودة 4K و 1080p مجاناً على سيرفرات سريعة وبدون إعلانات مزعجة.',
    url: siteUrl,
    siteName: 'EgyMax',
    locale: 'ar_EG',
    type: 'website',
    images: [
      {
        url: `${siteUrl}/icon.svg`,
        width: 1200,
        height: 630,
        alt: 'EGYMAX Cinema Stream',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'EGYMAX | بوابة المشاهدة الأولى للأفلام والمسلسلات الحصرية',
    description: 'شاهد وحمل أحدث الأفلام والمسلسلات العربية والأجنبية المترجمة بجودة 4K و 1080p مجاناً على سيرفرات سريعة وبدون إعلانات مزعجة.',
    images: [`${siteUrl}/icon.svg`],
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
        <GoogleAnalytics gaId="G-RSFGFP8NTZ" />
      </body>
    </html>
  );
}
