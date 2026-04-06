/* ================================================================
   নূরুল ইসলাম — ইসলামিক ড্যাশবোর্ড
   script.js
   ================================================================ */

'use strict';

/* ================================================================
   1. THEME TOGGLE
   ================================================================ */
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconEl    = document.getElementById('theme-icon');
const htmlEl         = document.documentElement;

/** Load previously saved theme or default to 'light' */
const savedTheme = localStorage.getItem('nurul-islam-theme') || 'light';
htmlEl.setAttribute('data-theme', savedTheme);
applyThemeIcon(savedTheme);

themeToggleBtn.addEventListener('click', () => {
    const current = htmlEl.getAttribute('data-theme');
    const next    = current === 'light' ? 'dark' : 'light';
    htmlEl.setAttribute('data-theme', next);
    localStorage.setItem('nurul-islam-theme', next);
    applyThemeIcon(next);
});

function applyThemeIcon(theme) {
    themeIconEl.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}


/* ================================================================
   2. LOCATION — store current coordinates for Qibla
   ================================================================ */
let lastKnownLat = null;
let lastKnownLon = null;

/** Update status bar below the location inputs */
function setStatus(msg, type = '') {
    const el = document.getElementById('location-status');
    el.textContent = msg;
    el.className   = 'location-status' + (type ? ' ' + type : '');
}

/** Search by city/country button */
document.getElementById('search-btn').addEventListener('click', () => {
    const city    = document.getElementById('city-input').value.trim();
    const country = document.getElementById('country-input').value.trim().toUpperCase() || 'BD';
    if (!city) {
        setStatus('শহরের নাম লিখুন।', 'error');
        return;
    }
    fetchPrayerTimesByCity(city, country);
});

/** Auto geolocation button */
document.getElementById('auto-location-btn').addEventListener('click', () => {
    if (!navigator.geolocation) {
        setStatus('আপনার ব্রাউজার জিওলোকেশন সমর্থন করে না।', 'error');
        return;
    }
    setStatus('লোকেশন খোঁজা হচ্ছে...', '');
    navigator.geolocation.getCurrentPosition(
        pos => {
            lastKnownLat = pos.coords.latitude;
            lastKnownLon = pos.coords.longitude;
            setStatus(`লোকেশন পাওয়া গেছে ✓`, 'success');
            fetchPrayerTimesByCoords(lastKnownLat, lastKnownLon);
            fetchQiblaDirection(lastKnownLat, lastKnownLon);
        },
        err => {
            const msgs = {
                1: 'লোকেশন অনুমতি দেওয়া হয়নি। ব্রাউজার সেটিং চেক করুন।',
                2: 'লোকেশন নির্ধারণ করা সম্ভব হয়নি।',
                3: 'লোকেশন নির্ধারণে সময় শেষ হয়ে গেছে।',
            };
            setStatus(msgs[err.code] || 'লোকেশন পাওয়া যায়নি।', 'error');
        },
        { timeout: 10000, maximumAge: 300000 }
    );
});

/** Enter key support on text inputs */
['city-input', 'country-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('search-btn').click();
    });
});


/* ================================================================
   3. PRAYER TIMES — fetch by city name
   ================================================================ */
/**
 * Fetches prayer times from Aladhan API by city name.
 * Endpoint: GET /v1/timingsByCity/{DD-MM-YYYY}?city=...&country=...&method=1
 * method=1 = University of Islamic Sciences, Karachi (common for BD/PK/IN)
 */
async function fetchPrayerTimesByCity(city, country) {
    showPrayerLoading();
    setStatus(`"${city}, ${country}" এর সময়সূচি লোড হচ্ছে...`, '');
    try {
        const date = getTodayForAPI();
        const url  = `https://api.aladhan.com/v1/timingsByCity/${date}?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=1`;
        const res  = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.status || 'API error');

        const { timings, date: dateInfo, meta } = json.data;
        renderPrayerTimes(timings);
        renderHijriDate(dateInfo.hijri);
        setStatus(`${city}, ${country} — সফলভাবে লোড হয়েছে ✓`, 'success');

        /* Use meta coords for Qibla if we don't have GPS coords */
        if (meta && meta.latitude && meta.longitude && !lastKnownLat) {
            fetchQiblaDirection(meta.latitude, meta.longitude);
        }
    } catch (err) {
        console.error('Prayer times fetch error:', err);
        showPrayerError('নামাজের সময়সূচি লোড ব্যর্থ হয়েছে। শহরের নাম ইংরেজিতে লিখুন (যেমন: Dhaka)।');
        setStatus('এরর: ' + (err.message || 'অজানা সমস্যা'), 'error');
    }
}

/**
 * Fetches prayer times by GPS coordinates.
 * Endpoint: GET /v1/timings/{DD-MM-YYYY}?latitude=...&longitude=...&method=1
 */
async function fetchPrayerTimesByCoords(lat, lon) {
    showPrayerLoading();
    try {
        const date = getTodayForAPI();
        const url  = `https://api.aladhan.com/v1/timings/${date}?latitude=${lat}&longitude=${lon}&method=1`;
        const res  = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.status || 'API error');

        renderPrayerTimes(json.data.timings);
        renderHijriDate(json.data.date.hijri);
    } catch (err) {
        console.error('Prayer times (coords) fetch error:', err);
        showPrayerError('নামাজের সময়সূচি লোড ব্যর্থ। ইন্টারনেট সংযোগ চেক করুন।');
    }
}


/* ================================================================
   4. RENDER PRAYER TIMES
   ================================================================ */
/** Prayer configuration: API key, Arabic name, Bengali name, icon class */
const PRAYERS = [
    { key: 'Fajr',    ar: 'الفجر',   bn: 'ফজর',      icon: 'fas fa-star-and-crescent' },
    { key: 'Sunrise', ar: 'الشروق',  bn: 'সূর্যোদয়',  icon: 'fas fa-sun'               },
    { key: 'Dhuhr',   ar: 'الظهر',   bn: 'জোহর',     icon: 'fas fa-cloud-sun'         },
    { key: 'Asr',     ar: 'العصر',   bn: 'আসর',      icon: 'fas fa-cloud'             },
    { key: 'Maghrib', ar: 'المغرب',  bn: 'মাগরিব',   icon: 'fas fa-moon'              },
    { key: 'Isha',    ar: 'العشاء',  bn: 'এশা',      icon: 'fas fa-star'              },
];

function renderPrayerTimes(timings) {
    const grid = document.getElementById('prayer-times-grid');

    /* Convert each prayer time to total minutes for comparison */
    const now        = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const enriched = PRAYERS.map(p => {
        const raw     = timings[p.key] || '00:00';     /* e.g. "05:12 (BST)" — strip TZ suffix */
        const clean   = raw.split(' ')[0];              /* "05:12" */
        const [h, m]  = clean.split(':').map(Number);
        return { ...p, raw: clean, totalMins: h * 60 + m };
    });

    /* Find the next prayer (first one after current time) */
    let nextIdx = enriched.findIndex(p => p.totalMins > nowMinutes);
    if (nextIdx === -1) nextIdx = 0;   /* Past Isha — highlight Fajr (next day) */

    /* Build HTML */
    grid.innerHTML = enriched.map((p, i) => `
        <div class="prayer-card${i === nextIdx ? ' next-prayer' : ''}" role="listitem">
            <i class="${p.icon} prayer-icon" aria-hidden="true"></i>
            <span class="prayer-name-arabic">${p.ar}</span>
            <span class="prayer-name-bn">${p.bn}</span>
            <span class="prayer-time">${to12Hour(p.raw)}</span>
            <span class="next-badge" aria-label="পরবর্তী নামাজ">পরবর্তী</span>
        </div>
    `).join('');
}

/** Convert "HH:MM" (24h) to "H:MM AM/PM" */
function to12Hour(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const ampm   = h >= 12 ? 'PM' : 'AM';
    const h12    = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function showPrayerLoading() {
    document.getElementById('prayer-times-grid').innerHTML = `
        <div class="loading-placeholder" style="grid-column:1/-1">
            <div class="spinner" role="status" aria-label="লোড হচ্ছে"></div>
            <p>নামাজের সময় লোড হচ্ছে...</p>
        </div>`;
}

function showPrayerError(msg) {
    document.getElementById('prayer-times-grid').innerHTML = `
        <div class="error-state" style="grid-column:1/-1">
            <i class="fas fa-circle-exclamation fa-2x" aria-hidden="true"></i>
            <p>${msg}</p>
        </div>`;
}


/* ================================================================
   5. HIJRI DATE
   ================================================================ */
/** Render hijri date from Aladhan's date object */
function renderHijriDate(hijri) {
    const MONTHS_BN = {
        1:  'মুহাররম',
        2:  'সফর',
        3:  'রবিউল আউয়াল',
        4:  'রবিউস সানি',
        5:  'জমাদিউল আউয়াল',
        6:  'জমাদিউস সানি',
        7:  'রজব',
        8:  'শাবান',
        9:  'রমজান',
        10: 'শাওয়াল',
        11: 'জিলকদ',
        12: 'জিলহজ',
    };

    const monthNum = Number(hijri.month.number);
    const monthBn  = MONTHS_BN[monthNum] || hijri.month.en;
    const dayBn    = toBn(hijri.day);
    const yearBn   = toBn(hijri.year);

    document.getElementById('hijri-text').textContent =
        `${dayBn} ${monthBn}, ${yearBn} হিজরি`;
}

/**
 * Convert ASCII digits to Bengali Unicode digits.
 * e.g., "1446" => "১৪৪৬"
 */
function toBn(n) {
    const map = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
    return String(n).split('').map(c => {
        const d = parseInt(c, 10);
        return isNaN(d) ? c : map[d];
    }).join('');
}


/* ================================================================
   6. QURAN — AYAH OF THE DAY
   ================================================================ */
/**
 * A curated list of 30 important Quranic ayahs.
 * The ayah displayed rotates based on day-of-year so it changes daily.
 * Each entry: ref = "surah:ayah" (for AlQuran Cloud API), meta info for display.
 */
const DAILY_AYAHS = [
    { ref: '2:255',  surahBn: 'আল-বাকারা',      ayahBn: '২৫৫', tafsir: 'আয়াতুল কুরসি — কুরআনের সর্বশ্রেষ্ঠ আয়াত। এতে আল্লাহর একত্ব, চিরন্তন জীবন, সর্বজ্ঞতা ও অসীম কর্তৃত্বের বর্ণনা রয়েছে। রাসুল (সা.) বলেছেন যে ঘরে এই আয়াত পড়া হয় সেখানে শয়তান প্রবেশ করে না।' },
    { ref: '3:185',  surahBn: 'আলে ইমরান',       ayahBn: '১৮৫', tafsir: 'প্রতিটি প্রাণকে মৃত্যুর স্বাদ নিতে হবে — এই আয়াত আমাদের স্মরণ করিয়ে দেয় দুনিয়া ক্ষণস্থায়ী। কিয়ামতের দিন কর্মফল পূর্ণভাবে দেওয়া হবে।' },
    { ref: '94:5',   surahBn: 'আল-ইনশিরাহ',     ayahBn: '৫',   tafsir: 'নিশ্চয়ই কষ্টের সাথেই স্বস্তি রয়েছে — আল্লাহ এ কথা দুইবার বলেছেন। আরবি ব্যাকরণ অনুযায়ী, "কষ্ট" একটি কিন্তু "স্বস্তি" একাধিক — তাই মুমিনের হতাশার কোনো কারণ নেই।' },
    { ref: '2:286',  surahBn: 'আল-বাকারা',       ayahBn: '২৮৬', tafsir: 'আল্লাহ কাউকে তার সাধ্যের বাইরে বোঝা চাপান না। এই আয়াতে একটি গুরুত্বপূর্ণ দোয়াও আছে: আমাদের ভুলে বা অনিচ্ছায় করা পাপ ক্ষমা চাওয়ার প্রার্থনা।' },
    { ref: '65:3',   surahBn: 'আত-তালাক',        ayahBn: '৩',   tafsir: 'যে আল্লাহর উপর তাওয়াক্কুল করে, তার জন্য আল্লাহই যথেষ্ট। নিজের পরিকল্পনার পাশাপাশি আল্লাহর উপর ভরসার অবিচ্ছেদ্য সম্পর্কের শিক্ষা।' },
    { ref: '39:53',  surahBn: 'আয-যুমার',        ayahBn: '৫৩',  tafsir: 'বলুন: হে আমার বান্দারা, যারা নিজেদের ব্যাপারে সীমালঙ্ঘন করেছ — আল্লাহর রহমত থেকে হতাশ হয়ো না। তিনি সব গুনাহ মাফ করেন। এটি হল কুরআনের সবচেয়ে আশার আয়াতগুলোর একটি।' },
    { ref: '13:28',  surahBn: 'আর-রাদ',          ayahBn: '২৮',  tafsir: 'জেনে রাখো, আল্লাহর স্মরণেই হৃদয় প্রশান্তি পায়। হৃদয়ের অস্থিরতার একমাত্র প্রকৃত সমাধান হলো যিকির — এটি কুরআনের ঘোষণা।' },
    { ref: '49:13',  surahBn: 'আল-হুজুরাত',     ayahBn: '১৩',  tafsir: 'মানুষকে জাতি-গোষ্ঠীতে বিভক্ত করা হয়েছে পরিচয়ের জন্য, শ্রেষ্ঠত্বের জন্য নয়। আল্লাহর কাছে শ্রেষ্ঠ সে যে সবচেয়ে বেশি তাকওয়াবান — ইসলামে মানবসাম্যের ঘোষণা।' },
    { ref: '16:97',  surahBn: 'আন-নাহল',         ayahBn: '৯৭',  tafsir: 'নেক আমলকারী মুমিন নারী বা পুরুষ — তাদের পার্থিব জীবন পবিত্র ও সুখী করা হবে। ইসলামে পুরুষ ও নারীর সমান আমলের সমান পুরস্কারের ঘোষণা।' },
    { ref: '2:152',  surahBn: 'আল-বাকারা',       ayahBn: '১৫২', tafsir: 'আমাকে স্মরণ করো, আমি তোমাদের স্মরণ করব এবং আমার কৃতজ্ঞতা আদায় করো। যিকির ও শুকরের মধ্যে গভীর সম্পর্কের নির্দেশনা।' },
    { ref: '55:13',  surahBn: 'আর-রহমান',        ayahBn: '১৩',  tafsir: 'তোমরা তোমাদের প্রভুর কোন নিয়ামতকে অস্বীকার করবে? এই প্রশ্নটি সূরা রহমানে ৩১ বার পুনরাবৃত্তি হয়েছে — জিন ও মানব উভয়কে উদ্দেশ্য করে।' },
    { ref: '29:45',  surahBn: 'আল-আনকাবুত',     ayahBn: '৪৫',  tafsir: 'নামাজ কায়েম করো। নিশ্চয়ই নামাজ অশ্লীল ও মন্দ কাজ থেকে বিরত রাখে। যে নামাজ পড়েও পাপে লিপ্ত থাকে, তার নামাজের গুণমান নিয়ে ভাবা উচিত।' },
    { ref: '2:153',  surahBn: 'আল-বাকারা',       ayahBn: '১৫৩', tafsir: 'ধৈর্য ও নামাজের মাধ্যমে সাহায্য চাও। আল্লাহ ধৈর্যশীলদের সাথে আছেন — এটি মুমিনের জন্য সবচেয়ে শক্তিশালী আশ্বাসগুলোর একটি।' },
    { ref: '14:7',   surahBn: 'ইবরাহিম',         ayahBn: '৭',   tafsir: 'কৃতজ্ঞ হলে আল্লাহ আরও বৃদ্ধি করবেন, অকৃতজ্ঞ হলে আজাব কঠিন হবে। শুকরের সরাসরি ফলাফলের এই প্রতিশ্রুতি মুমিনকে সবসময় কৃতজ্ঞ থাকতে অনুপ্রাণিত করে।' },
    { ref: '3:139',  surahBn: 'আলে ইমরান',       ayahBn: '১৩৯', tafsir: 'হতাশ হয়ো না, দুঃখ করো না — তোমরাই বিজয়ী যদি সত্যিকারের মুমিন হও। ওহুদ যুদ্ধের পরিপ্রেক্ষিতে নাযিল — কঠিন মুহূর্তে সাহস ও প্রত্যয়ের ঘোষণা।' },
    { ref: '23:1',   surahBn: 'আল-মুমিনুন',     ayahBn: '১',   tafsir: 'মুমিনরা নিঃসন্দেহে সফল হয়েছে। এরপর কয়েকটি আয়াতে সফল মুমিনের সুনির্দিষ্ট গুণাবলী বর্ণনা করা হয়েছে — খুশুভরা নামাজ, যাকাত, পবিত্রতা ও আমানতদারী।' },
    { ref: '57:20',  surahBn: 'আল-হাদিদ',        ayahBn: '২০',  tafsir: 'দুনিয়ার জীবন খেলা, মজা, সৌন্দর্য ও পরস্পরের গর্বের বিষয়মাত্র — মৃত্যুর পর সব শেষ। তাই দুনিয়াকে লক্ষ্য না বানিয়ে পরকালকে লক্ষ্য বানাও।' },
    { ref: '18:46',  surahBn: 'আল-কাহফ',         ayahBn: '৪৬',  tafsir: 'সম্পদ ও সন্তান দুনিয়ার অলংকার মাত্র। নেক আমলই আল্লাহর কাছে স্থায়ী এবং পুরস্কারের দিক থেকে সর্বোত্তম।' },
    { ref: '33:41',  surahBn: 'আল-আহযাব',        ayahBn: '৪১',  tafsir: 'হে মুমিনগণ, আল্লাহকে বেশি বেশি স্মরণ করো এবং সকাল-সন্ধ্যা তাঁর পবিত্রতা বর্ণনা করো। যিকিরের আদেশ সরাসরি মুমিনদের উদ্দেশ্যে।' },
    { ref: '9:51',   surahBn: 'আত-তাওবা',        ayahBn: '৫১',  tafsir: 'আল্লাহ আমাদের জন্য যা লিখে রেখেছেন তাই হবে — তিনিই আমাদের অভিভাবক। এটি তাওয়াক্কুলের মূলভিত্তি এবং মুমিনের হৃদয়ে শান্তির উৎস।' },
    { ref: '31:17',  surahBn: 'লুকমান',           ayahBn: '১৭',  tafsir: 'নামাজ কায়েম করো, ভালো কাজের আদেশ দাও, মন্দ থেকে নিষেধ করো এবং যা বিপদ আসে তাতে ধৈর্য ধরো। লুকমান তাঁর পুত্রকে এই উপদেশ দিয়েছিলেন।' },
    { ref: '59:22',  surahBn: 'আল-হাশর',         ayahBn: '২২',  tafsir: 'তিনি আল্লাহ — তিনি ছাড়া কোনো ইলাহ নেই। তিনি গায়েব ও প্রকাশ্য সব কিছুই জানেন। তিনিই পরম দয়ালু অতিশয় করুণাময়।' },
    { ref: '112:1',  surahBn: 'আল-ইখলাস',        ayahBn: '১',   tafsir: 'বলুন: তিনি আল্লাহ, এক। তাওহীদের সারাংশ এই সূরায়। রাসুল (সা.) বলেছেন এই সূরা কুরআনের এক-তৃতীয়াংশের সমান।' },
    { ref: '67:2',   surahBn: 'আল-মুলক',          ayahBn: '২',   tafsir: 'তিনি সৃষ্টি করেছেন মৃত্যু ও জীবন — যাতে পরীক্ষা করেন কে আমলের দিক থেকে সর্বোত্তম। জীবনের উদ্দেশ্য এবং পরকালের প্রস্তুতির তাগিদ।' },
    { ref: '4:36',   surahBn: 'আন-নিসা',          ayahBn: '৩৬',  tafsir: 'আল্লাহর ইবাদত করো এবং কাউকে শরিক করো না। পিতামাতা, আত্মীয়, এতিম, মিসকিন ও প্রতিবেশীর হক আদায়ের বিস্তারিত নির্দেশনা।' },
    { ref: '17:80',  surahBn: 'আল-ইসরা',          ayahBn: '৮০',  tafsir: 'হে প্রভু, আমাকে সত্যের সাথে প্রবেশ করাও এবং সত্যের সাথে বের করো — একটি অত্যন্ত গুরুত্বপূর্ণ দোয়া। সফর, নতুন কাজ ও গুরুত্বপূর্ণ মুহূর্তে পড়া হয়।' },
    { ref: '7:31',   surahBn: 'আল-আরাফ',          ayahBn: '৩১',  tafsir: 'খাও, পান করো এবং পোশাক পরো কিন্তু অপচয় করো না। ইসলামে মধ্যপন্থার নির্দেশনা এবং অপচয়ের বিরুদ্ধে স্পষ্ট নিষেধ।' },
    { ref: '2:45',   surahBn: 'আল-বাকারা',        ayahBn: '৪৫',  tafsir: 'ধৈর্য ও নামাজের মাধ্যমে সাহায্য চাও। এটি কঠিন বটে, তবে যারা আল্লাহর সামনে বিনম্র তাদের জন্য নয়।' },
    { ref: '3:8',    surahBn: 'আলে ইমরান',        ayahBn: '৮',   tafsir: 'হে আমাদের প্রভু, সঠিকপথ দেখানোর পর আমাদের অন্তর বিচ্যুত করো না। মুমিনের হেদায়াতের উপর অবিচল থাকার দোয়া।' },
    { ref: '20:114', surahBn: 'ত্বা-হা',           ayahBn: '১১৪', tafsir: 'হে আমার প্রভু, আমার জ্ঞান বৃদ্ধি করুন — এই সংক্ষিপ্ত দোয়াটি জ্ঞানার্জনের আগ্রহীদের জন্য অত্যন্ত গুরুত্বপূর্ণ। জ্ঞান অন্বেষণ ইসলামের মূলনীতি।' },
];

/**
 * Load today's Quran ayah.
 * Uses AlQuran Cloud API to fetch Arabic text + Bengali translation.
 * Endpoint: GET /v1/ayah/{surah:ayah}/editions/quran-uthmani,bn.bengali
 */
async function loadDailyAyah() {
    const container = document.getElementById('quran-content');
    const dayIdx    = getDayOfYear() % DAILY_AYAHS.length;
    const ayahMeta  = DAILY_AYAHS[dayIdx];

    try {
        const url = `https://api.alquran.cloud/v1/ayah/${ayahMeta.ref}/editions/quran-uthmani,bn.bengali`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.status || 'API error');

        /* data[0] = quran-uthmani (Arabic), data[1] = bn.bengali */
        const arabicData  = json.data[0];
        const bengaliData = json.data[1];

        container.innerHTML = `
            <div class="quran-ref">
                <i class="fas fa-bookmark" aria-hidden="true"></i>
                সূরা ${ayahMeta.surahBn} — আয়াত ${ayahMeta.ayahBn}
            </div>
            <div class="quran-arabic" dir="rtl" lang="ar">
                ${arabicData.text}
            </div>
            <div class="quran-translation">
                ${bengaliData.text}
            </div>
            <div class="quran-tafsir">
                <strong><i class="fas fa-lightbulb" aria-hidden="true"></i> সংক্ষিপ্ত তাফসির:</strong><br>
                ${ayahMeta.tafsir}
            </div>
        `;
    } catch (err) {
        console.error('Quran ayah fetch error:', err);
        container.innerHTML = `
            <div class="error-state">
                <i class="fas fa-circle-exclamation fa-2x" aria-hidden="true"></i>
                <p>আয়াত লোড ব্যর্থ। ইন্টারনেট সংযোগ চেক করুন।</p>
            </div>`;
    }
}


/* ================================================================
   7. HADITH OF THE DAY (Curated Sahih Collection)
   ================================================================
   These are verified authentic hadiths from Bukhari, Muslim and
   other Sahih collections with Bengali translations.
   Rotates daily by day-of-year index.
   ================================================================ */
const HADITHS = [
    {
        arabic:   'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى',
        text:     'সকল কাজ নিয়তের উপর নির্ভরশীল এবং প্রত্যেক ব্যক্তি তাই পাবে যা সে নিয়ত করে। তাই যার হিজরত আল্লাহ ও তাঁর রাসুলের জন্য, তার হিজরত সেদিকেই। আর যার হিজরত দুনিয়া বা বিয়ের জন্য, তার হিজরত সে উদ্দেশ্যেই।',
        source:   'সহীহ বুখারি — ১', narrator: 'হযরত উমার ইবনুল খাত্তাব (রা.)'
    },
    {
        arabic:   'الدِّينُ النَّصِيحَةُ',
        text:     'দ্বীন হলো আন্তরিক কল্যাণ কামনা। সাহাবীরা জিজ্ঞেস করলেন: কার জন্য? তিনি বললেন: আল্লাহর জন্য, তাঁর কিতাবের জন্য, তাঁর রাসুলের জন্য, মুসলিম নেতাদের জন্য এবং সাধারণ মুসলিমদের জন্য।',
        source:   'সহীহ মুসলিম — ৫৫', narrator: 'হযরত তামিম আদ-দারি (রা.)'
    },
    {
        arabic:   'لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ',
        text:     'তোমাদের কেউ পূর্ণ মুমিন হবে না, যতক্ষণ না সে তার মুসলিম ভাইয়ের জন্য তাই পছন্দ করে যা সে নিজের জন্য পছন্দ করে।',
        source:   'সহীহ বুখারি — ১৩', narrator: 'হযরত আনাস ইবনে মালিক (রা.)'
    },
    {
        arabic:   'الْمُسْلِمُ مَنْ سَلِمَ الْمُسْلِمُونَ مِنْ لِسَانِهِ وَيَدِهِ',
        text:     'প্রকৃত মুসলিম সে ব্যক্তি যার জিহ্বা ও হাত থেকে অন্য মুসলিমরা নিরাপদ থাকে। এবং প্রকৃত মুহাজির সে যে আল্লাহর নিষিদ্ধ কাজ ছেড়ে দেয়।',
        source:   'সহীহ বুখারি — ১০', narrator: 'হযরত আবদুল্লাহ ইবনে আমর (রা.)'
    },
    {
        arabic:   'أَحَبُّ الْأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ',
        text:     'আল্লাহর কাছে সবচেয়ে প্রিয় আমল হলো যা নিয়মিত করা হয়, যদিও তা পরিমাণে কম হোক। তাই যতটুকু পারো ততটুকুই নিয়মিতভাবে করো।',
        source:   'সহীহ বুখারি — ৬৪৬৫', narrator: 'হযরত আয়েশা (রা.)'
    },
    {
        arabic:   'اتَّقِ اللَّهَ حَيْثُمَا كُنْتَ وَأَتْبِعِ السَّيِّئَةَ الْحَسَنَةَ تَمْحُهَا',
        text:     'যেখানেই থাকো আল্লাহকে ভয় করো। খারাপ কাজের পর ভালো কাজ করো — তা খারাপকে মুছে দেবে। এবং মানুষের সাথে উত্তম আচরণ করো।',
        source:   'সুনান তিরমিজি — ১৯৮৭ (হাসান সহীহ)', narrator: 'হযরত মুয়াজ ইবনে জাবাল (রা.)'
    },
    {
        arabic:   'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ',
        text:     'তোমাদের মধ্যে সর্বোত্তম সে ব্যক্তি যে কুরআন শেখে এবং অন্যকে শেখায়।',
        source:   'সহীহ বুখারি — ৫০২৭', narrator: 'হযরত উসমান ইবনে আফফান (রা.)'
    },
    {
        arabic:   'مَنْ صَامَ رَمَضَانَ إِيمَانًا وَاحْتِسَابًا غُفِرَ لَهُ مَا تَقَدَّمَ مِنْ ذَنْبِهِ',
        text:     'যে ব্যক্তি ঈমান ও সওয়াবের আশায় রমজান মাসে রোজা রাখে, তার পূর্ববর্তী সকল গুনাহ মাফ করে দেওয়া হয়।',
        source:   'সহীহ বুখারি — ৩৮', narrator: 'হযরত আবু হুরায়রা (রা.)'
    },
    {
        arabic:   'مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ',
        text:     'যে ব্যক্তি আল্লাহ ও পরকালে বিশ্বাস করে, সে যেন ভালো কথা বলে অথবা চুপ থাকে। যে প্রতিবেশীকে সম্মান করে এবং অতিথিকে সমাদর করে।',
        source:   'সহীহ বুখারি — ৬০১৮', narrator: 'হযরত আবু হুরায়রা (রা.)'
    },
    {
        arabic:   'إِنَّ اللَّهَ رَفِيقٌ يُحِبُّ الرِّفْقَ وَيُعْطِي عَلَى الرِّفْقِ مَا لَا يُعْطِي عَلَى الْعُنْفِ',
        text:     'আল্লাহ কোমল এবং তিনি কোমলতাকে পছন্দ করেন। কোমলতার বিনিময়ে তিনি যা দেন, কঠোরতায় তা দেন না।',
        source:   'সহীহ মুসলিম — ২৫৯৩', narrator: 'হযরত আয়েশা (রা.)'
    },
    {
        arabic:   'الطُّهُورُ شَطْرُ الْإِيمَانِ وَالْحَمْدُ لِلَّهِ تَمْلَأُ الْمِيزَانَ',
        text:     'পবিত্রতা ঈমানের অর্ধেক। আলহামদুলিল্লাহ মিজান পূর্ণ করে। সুবহানআল্লাহ ও আলহামদুলিল্লাহ আকাশ ও পৃথিবী পরিপূর্ণ করে।',
        source:   'সহীহ মুসলিম — ২২৩', narrator: 'হযরত আবু মালিক আল-আশআরি (রা.)'
    },
    {
        arabic:   'خَيْرُ النَّاسِ أَنْفَعُهُمْ لِلنَّاسِ',
        text:     'সর্বোত্তম মানুষ সে যে মানুষের জন্য সবচেয়ে বেশি উপকারী। ইসলাম ব্যক্তিস্বার্থের চেয়ে সমাজের কল্যাণকে বেশি গুরুত্ব দেয়।',
        source:   'আল-মুজামুল আওসাত — ৫৭৮৭ (সহীহ)', narrator: 'হযরত জাবির ইবনে আবদুল্লাহ (রা.)'
    },
    {
        arabic:   'مَنْ نَفَّسَ عَنْ مُؤْمِنٍ كُرْبَةً مِنْ كُرَبِ الدُّنْيَا نَفَّسَ اللَّهُ عَنْهُ كُرْبَةً مِنْ كُرَبِ يَوْمِ الْقِيَامَةِ',
        text:     'যে কোনো মুমিনের দুনিয়ার কোনো বিপদ দূর করে, আল্লাহ কিয়ামতের দিন তার বিপদ দূর করবেন। যে কোনো কষ্টে পড়া ব্যক্তিকে সহজ করে দেয়, আল্লাহ দুনিয়া ও আখেরাতে তাকে সহজ করে দেবেন।',
        source:   'সহীহ মুসলিম — ২৬৯৯', narrator: 'হযরত আবু হুরায়রা (রা.)'
    },
    {
        arabic:   'ازْهَدْ فِي الدُّنْيَا يُحِبَّكَ اللَّهُ، وَازْهَدْ فِيمَا عِنْدَ النَّاسِ يُحِبَّكَ النَّاسُ',
        text:     'দুনিয়ার প্রতি বিরাগী হও, আল্লাহ তোমাকে ভালোবাসবেন। মানুষের কাছে যা আছে তার প্রতি অনাগ্রহী হও, মানুষ তোমাকে ভালোবাসবে।',
        source:   'সুনান ইবনে মাজাহ — ৪১০২ (সহীহ)', narrator: 'হযরত সাহল ইবনে সাদ (রা.)'
    },
    {
        arabic:   'الصَّلَوَاتُ الْخَمْسُ، وَالْجُمْعَةُ إِلَى الْجُمْعَةِ كَفَّارَةٌ لِمَا بَيْنَهُنَّ مَا لَمْ تُغْشَ الْكَبَائِرُ',
        text:     'পাঁচ ওয়াক্ত নামাজ এবং এক জুমা থেকে পরবর্তী জুমা পর্যন্ত মধ্যবর্তী সময়ের (ছোট) গুনাহের কাফফারা — যতক্ষণ কবিরা গুনাহে লিপ্ত না হওয়া হয়।',
        source:   'সহীহ মুসলিম — ২৩৩', narrator: 'হযরত আবু হুরায়রা (রা.)'
    },
];

function loadDailyHadith() {
    const container = document.getElementById('hadith-content');
    const dayIdx    = getDayOfYear() % HADITHS.length;
    const h         = HADITHS[dayIdx];

    container.innerHTML = `
        <div class="hadith-arabic" dir="rtl" lang="ar">${h.arabic}</div>
        <div class="hadith-text">${h.text}</div>
        <div>
            <span class="hadith-source">
                <i class="fas fa-book" aria-hidden="true"></i> ${h.source}
            </span>
            <span class="hadith-narrator">
                <i class="fas fa-user" aria-hidden="true"></i> বর্ণনায়: ${h.narrator}
            </span>
        </div>
    `;
}


/* ================================================================
   8. QIBLA DIRECTION
   ================================================================ */
/**
 * Fetches Qibla direction from Aladhan API.
 * Endpoint: GET /v1/qibla/{latitude}/{longitude}
 * Returns degrees from North (clockwise) toward Mecca.
 */
async function fetchQiblaDirection(lat, lon) {
    const container = document.getElementById('qibla-content');
    container.innerHTML = `
        <div class="loading-placeholder">
            <div class="spinner" role="status"></div>
            <p>কিবলার দিক নির্ধারণ হচ্ছে...</p>
        </div>`;

    try {
        const res  = await fetch(`https://api.aladhan.com/v1/qibla/${lat}/${lon}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.status || 'API error');

        renderQiblaCompass(json.data.direction);
    } catch (err) {
        console.error('Qibla fetch error:', err);
        container.innerHTML = `
            <div class="error-state">
                <i class="fas fa-circle-exclamation fa-2x" aria-hidden="true"></i>
                <p>কিবলার দিক লোড ব্যর্থ। লোকেশন প্রদান করুন।</p>
            </div>`;
    }
}

/**
 * Renders the Qibla compass with the needle rotated to the correct angle.
 * @param {number} degrees - degrees from North, clockwise, toward Qibla
 */
function renderQiblaCompass(degrees) {
    const container = document.getElementById('qibla-content');
    const rounded   = Math.round(degrees * 10) / 10;   /* 1 decimal precision */
    const roundedBn = toBn(Math.round(rounded));

    container.innerHTML = `
        <div class="compass-wrapper" aria-label="কিবলা কম্পাস">
            <div class="compass-outer-ring">
                <span class="c-n" aria-label="উত্তর">N</span>
                <span class="c-s" aria-label="দক্ষিণ">S</span>
                <span class="c-e" aria-label="পূর্ব">E</span>
                <span class="c-w" aria-label="পশ্চিম">W</span>
                <div class="compass-inner-dial">
                    <div
                        class="qibla-needle"
                        id="qibla-needle"
                        style="transform: rotate(0deg)"
                        role="img"
                        aria-label="কিবলা নির্দেশক সুই"
                    >
                        <span class="needle-tip" aria-hidden="true">🕋</span>
                    </div>
                    <div class="compass-pivot"></div>
                </div>
            </div>
        </div>
        <div class="qibla-info" role="region" aria-label="কিবলার তথ্য">
            <div class="qibla-degree-value">
                ${roundedBn}<sup>°</sup>
            </div>
            <div class="qibla-direction-label">উত্তর থেকে ঘড়ির কাঁটার দিকে</div>
            <div class="qibla-note">
                <i class="fas fa-circle-info" aria-hidden="true"></i>
                আপনার ডিভাইসের কম্পাস অ্যাপে <strong>${rounded}°</strong>
                দেখালে সেটি কাবার দিক। সুইটি এই কোণে ঘুরিয়ে নিন।
            </div>
        </div>
    `;

    /* Animate needle: slight delay so the rotation is visible */
    requestAnimationFrame(() => {
        setTimeout(() => {
            const needle = document.getElementById('qibla-needle');
            if (needle) needle.style.transform = `rotate(${degrees}deg)`;
        }, 300);
    });
}


/* ================================================================
   9. UTILITY FUNCTIONS
   ================================================================ */

/** Returns today's date as "DD-MM-YYYY" for Aladhan API */
function getTodayForAPI() {
    const d  = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}-${mm}-${yy}`;
}

/**
 * Returns the day number of the year (1–366).
 * Used to rotate daily content consistently for all users on the same day.
 */
function getDayOfYear() {
    const now   = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff  = now - start;
    return Math.floor(diff / 86400000);   /* 86400000 ms = 1 day */
}


/* ================================================================
   10. INITIALISATION
   ================================================================ */
function init() {
    /* Set default city/country */
    document.getElementById('city-input').value    = 'Dhaka';
    document.getElementById('country-input').value = 'BD';

    /* Load content that needs no location */
    loadDailyAyah();
    loadDailyHadith();

    /* Load default prayer times for Dhaka */
    fetchPrayerTimesByCity('Dhaka', 'BD');

    /* Load default Qibla for Dhaka (coords: 23.8103, 90.4125) */
    fetchQiblaDirection(23.8103, 90.4125);
}

/* Run when DOM is ready */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
