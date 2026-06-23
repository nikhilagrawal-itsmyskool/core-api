// Curated Tier-2 DDC numbers - deeper than the free 1000 Sections (which stop at
// 3 digits). These sit in the paid DDC schedules, but the *numbers themselves*
// are standard/factual, so we author our own short list for high-use areas
// (school context: sports, Indian history & literature, common biography),
// including the ".092" biography forms. Beyond this, the cataloguer types a
// number once and self-learning suggests it thereafter.
//
// `parent` is the 3-digit section these hang under (for browsing). Seeded into
// library_ddc at level 'section'. Extend freely - this is our own data.

const RAW = `
794.1|Chess|794
796.092|Sports & athletes - biography|796
796.3|Ball games|796
796.32|Inflated-ball games (hand)|796
796.323|Basketball|796
796.323092|Basketball - biography|796
796.325|Volleyball|796
796.33|Football (foot-driven ball)|796
796.332|American football|796
796.333|Rugby football|796
796.334|Soccer (association football)|796
796.334092|Soccer - biography|796
796.34|Racket games|796
796.342|Tennis|796
796.342092|Tennis - biography|796
796.345|Badminton|796
796.346|Table tennis|796
796.35|Ball driven by club/bat|796
796.352|Golf|796
796.355|Field hockey|796
796.357|Baseball|796
796.357092|Baseball - biography|796
796.358|Cricket|796
796.358092|Cricket - biography|796
796.4|Weight lifting, track & field, gymnastics|796
796.42|Track & field athletics|796
796.42092|Athletics - biography|796
796.44|Gymnastics|796
796.6|Cycling|796
796.7|Motor sports|796
796.72|Automobile racing|796
796.72092|Motorsport - biography|796
796.75|Motorcycle racing|796
796.8|Combat sports|796
796.812|Wrestling|796
796.815|Judo|796
796.83|Boxing|796
796.83092|Boxing - biography|796
796.9|Ice & snow sports|796
796.91|Ice skating|796
796.93|Skiing|796
796.962|Ice hockey|796
797.2|Swimming|797
797.21|Swimming - biography|797
798.4|Horse racing|798
799.1|Fishing|799
799.2|Hunting|799
891.2|Sanskrit literature|891
891.43|Hindi literature|891
891.44|Bengali literature|891
891.45|Marathi literature|891
891.46|Gujarati / Punjabi literature|891
891.48|Odia / Assamese literature|891
923|Biography of people in social sciences|920
923.154|India - political leaders (biography)|920
920.02|Collected biography (general)|920
954.01|Ancient India (to 647)|954
954.02|Medieval India (647-1761)|954
954.03|British India (1761-1947)|954
954.035|Indian independence movement|954
954.035092|Indian freedom fighters - biography|954
954.04|India since independence (1947- )|954
954.04092|Modern India - leaders (biography)|954
`;

export const DDC_CURATED: { code: string; label: string; parent: string }[] = RAW.split(
  "\n",
)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [code, label, parent] = l.split("|");
    return { code, label, parent };
  });
