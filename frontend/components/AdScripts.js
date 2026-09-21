import Script from 'next/script';

export default function AdScripts() {
  return (
    <>
      {/* ProfitableRate CPM / Adsterra Network */}
      <Script
        id="ad-cpm-network"
        src="https://pl31448406.profitableratecpmnetwork.com/91/58/99/915899e31346793083e7f2ce5bd40d86.js"
        strategy="afterInteractive"
      />
    </>
  );
}
