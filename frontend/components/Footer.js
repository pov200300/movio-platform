import Link from 'next/link';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.topBorderGlow} />
      <div className="container">
        <div className={styles.footerGrid}>
          {/* Brand & Slogan */}
          <div className={styles.brandCol}>
            <Link href="/" className={styles.logo} aria-label="EGYMAX الرئيسية">
              <span className={styles.logoIconWrapper}>
                <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
                  <rect width="64" height="64" rx="16" fill="#050608" />
                  <rect width="61" height="61" x="1.5" y="1.5" rx="14.5" fill="none" stroke="#ffffff" strokeWidth="1.8" />
                  <circle cx="51" cy="14" r="2.5" fill="#ff1723" />
                  <path d="M14 16 H31 L28 23 H21 V28 H28 L25 35 H21 V41 H30 L27 48 H14 Z" fill="#e50914" />
                  <path d="M33 16 H40 L50 32 L40 48 H33 L43 32 Z" fill="#ffffff" />
                  <path d="M49 16 H43 L33 32 L43 48 H49 L39 32 Z" fill="#ff1723" />
                </svg>
              </span>
              <span className={styles.logoText}>
                <span className={styles.logoRed}>EGY</span>
                <span className={styles.logoWhite}>MAX</span>
              </span>
            </Link>
            <p className={styles.brandDescription}>
              منصة EGYMAX هي بوابتك الرقمية الأولى لمشاهدة وتحميل أحدث الأفلام والمسلسلات العربية والأجنبية بجودة فائقة وبشكل مجاني وسلس على مدار الساعة.
            </p>
            <div className={styles.featuresPills}>
              <span className={styles.pill}>⚡ سيرفرات صاروخية</span>
              <span className={styles.pill}>🍿 ترجمة احترافية</span>
              <span className={styles.pill}>🎬 جودة 4K / 1080p</span>
            </div>
          </div>

          {/* Quick Links */}
          <div className={styles.linksCol}>
            <h4 className={styles.columnTitle}>روابط سريعة</h4>
            <ul className={styles.linksList}>
              <li><Link href="/">الرئيسية</Link></li>
              <li><Link href="/movies">جميع الأفلام</Link></li>
              <li><Link href="/movies?year=2026">أفلام 2026</Link></li>
              <li><Link href="/movies?quality=1080p">الأعلى تقييماً</Link></li>
              <li><Link href="/categories">تصفح التصنيفات</Link></li>
            </ul>
          </div>

          {/* Categories Links */}
          <div className={styles.linksCol}>
            <h4 className={styles.columnTitle}>الأقسام والأنواع</h4>
            <ul className={styles.linksList}>
              <li><Link href="/movies?genre=action">أفلام أكشن</Link></li>
              <li><Link href="/movies?genre=thriller">إثارة وغموض</Link></li>
              <li><Link href="/movies?genre=comedy">أفلام كوميدية</Link></li>
              <li><Link href="/movies?genre=scifi">خيال علمي</Link></li>
              <li><Link href="/movies?genre=drama">دراما عائلية</Link></li>
            </ul>
          </div>

          {/* Legal / Notice */}
          <div className={styles.noticeCol}>
            <h4 className={styles.columnTitle}>إخلاء مسؤولية قانوني</h4>
            <p className={styles.noticeText}>
              كافة المواد والأفلام المتاحة على موقع EGYMAX يتم جلبها من مصادر وسيرفرات خارجية عبر الإنترنت ومواقع البث العامة. الموقع لا يقوم برفع أو تخزين أي محتوى فيديو على خوادمه إطلاقاً.
            </p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className={styles.bottomBar}>
          <p className={styles.copyright}>
            © 2026 <span className={styles.bold}>EGYMAX</span> - جميع الحقوق محفوظة
          </p>
          <div className={styles.bottomLinks}>
            <span>تصميم وتطوير فائق الأداء</span>
            <span className={styles.divider}>•</span>
            <Link href="/">سياسة الاستخدام</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
