// server.js (cleaned)
// Run:
// npm init -y
// npm install express node-fetch dotenv
// node server.js
//
// Open http://localhost:3000

require('dotenv').config();

const express = require('express');

// Robust fetch support: prefer global fetch (Node 18+), otherwise try node-fetch
let fetchFn = global.fetch;
try {
  if (!fetchFn) {
    const nf = require('node-fetch');
    fetchFn = nf && nf.default ? nf.default : nf;
  }
} catch (err) {
  // node-fetch not installed and global fetch missing
  // We'll throw later if fetch is required and missing
}
const fetch = fetchFn;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static frontend files from the 'public' folder
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Basic route to serve index.html (single index route kept)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ======================
   CONFIG: prefer environment variables; fallback to the values you provided
   (For production move all keys into env vars and restrict Google key by referrer)
   ====================== */
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "9ba38385072be48414cd254fe6006ab0";
const AIRNOW_API_KEY      = process.env.AIRNOW_API_KEY      || "C91D51E6-E7AB-463D-B27C-E500944E79C9";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyB6yyLwRfSRwCenlkpLYF7nKPMczewfrOA";
// Gemini (Generative) API key (optional) - set via env for safety in production
const GEMINI_API_KEY      = process.env.GEMINI_API_KEY || ""; // keep empty if you want fallback demo responses

const OPENAQ_BASE = "https://api.openaq.org/v2/measurements";

/* ======================
   /maps -> redirect to Google Maps JS with the key (keeps key in server file)
   ====================== */
app.get('/maps', (req, res) => {
  const libs = 'places,drawing,geometry';
  const mapsUrl = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=${encodeURIComponent(libs)}&v=weekly`;
  return res.redirect(mapsUrl);
});

/* ======================
   /api/openaq?lat=&lon=&radius=&days=
   -> aggregated PM2.5 from OpenAQ
   ====================== */
app.get('/api/openaq', async (req, res) => {
  try {
    if (!fetch) return res.status(500).json({ error: 'Server fetch not available. Install node-fetch or run Node 18+' });

    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = parseInt(req.query.radius || '5000', 10);
    const days = parseInt(req.query.days || '1', 10);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat,lon required' });

    const now = new Date();
    const dateTo = now.toISOString();
    const daysSafe = Math.max(1, isFinite(days) ? days : 1);
    const dateFrom = new Date(now.getTime() - (daysSafe * 24 * 3600 * 1000)).toISOString();

    const url = new URL(OPENAQ_BASE);
    url.searchParams.set('parameter', 'pm25');
    url.searchParams.set('coordinates', `${lat},${lon}`);
    url.searchParams.set('radius', String(radius));
    url.searchParams.set('date_from', dateFrom);
    url.searchParams.set('date_to', dateTo);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('sort', 'desc');

    const r = await fetch(url.toString());
    if (!r.ok) {
      return res.status(500).json({ error: 'OpenAQ fetch failed', status: r.status });
    }
    const j = await r.json();
    const vals = (j.results || []).map(o => ({
      value: o.value,
      date: o.date && o.date.local ? o.date.local : (o.date && o.date.utc ? o.date.utc : null),
      unit: o.unit,
      location: o.location,
      country: o.country
    }));
    const numeric = vals.map(v => Number(v.value)).filter(x => Number.isFinite(x));
    const mean = numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
    return res.json({ mean, values: numeric, raw: vals, meta: j.meta || null });
  } catch (err) {
    console.error('openaq error', err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================
   /api/openweather?lat=&lon=
   -> OpenWeather current weather
   ====================== */
app.get('/api/openweather', async (req, res) => {
  try {
    if (!fetch) return res.status(500).json({ error: 'Server fetch not available' });
    const lat = req.query.lat; const lon = req.query.lon;
    if (!lat || !lon) return res.status(400).json({ error: 'lat,lon required' });
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&appid=${encodeURIComponent(OPENWEATHER_API_KEY)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(500).json({ error: 'OpenWeather fetch failed', status: r.status });
    const j = await r.json();
    return res.json(j);
  } catch (err) {
    console.error('openweather error', err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================
   /api/airnow?lat=&lon=
   -> AirNow USA observations (works in US lat/lon)
   ====================== */
app.get('/api/airnow', async (req, res) => {
  try {
    if (!fetch) return res.status(500).json({ error: 'Server fetch not available' });
    const lat = req.query.lat; const lon = req.query.lon;
    if (!lat || !lon) return res.status(400).json({ error: 'lat,lon required' });
    const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&distance=25&API_KEY=${encodeURIComponent(AIRNOW_API_KEY)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(500).json({ error: 'AirNow fetch failed', status: r.status });
    const j = await r.json();
    return res.json(j);
  } catch (err) {
    console.error('airnow error', err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================
   /api/gemini (POST) - simple proxy to Google Generative Language or fallback
   ====================== */
app.post('/api/gemini', async (req, res) => {
  try {
    if (!fetch) return res.status(500).json({ error: 'Server fetch not available' });
    const { prompt, systemInstruction } = req.body || {};
    
    // Check if API key exists
    if (!GEMINI_API_KEY) {
      console.log('⚠️  No GEMINI_API_KEY found - using fallback');
      const fallback = `Demo AI summary: The area shows elevated PM2.5 values, with hotspots near industrial and high-traffic zones. Main pollutants: PM2.5 and NO2. Recommended actions: reduce traffic near sensitive zones, temporary emission controls in industrial clusters, and public health advisories for vulnerable groups.`;
      return res.json({ text: fallback });
    }
    
    console.log('🔑 Gemini API Key found (length:', GEMINI_API_KEY.length, ')');
    console.log('📝 Prompt:', prompt?.substring(0, 100) + '...');
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const payload = {
      contents: [{ parts: [{ text: prompt || '' }] }],
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {})
    };
    
    console.log('🌐 Calling Gemini API...');
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log('📊 Response status:', r.status, r.statusText);
    
    if (!r.ok) {
      const txt = await r.text();
      console.error('❌ Gemini API Error Response:', txt);
      let errorMsg = 'Gemini API error';
      try {
        const errJson = JSON.parse(txt);
        errorMsg = errJson.error?.message || errJson.error || txt;
      } catch {
        errorMsg = txt;
      }
      return res.status(500).json({ 
        error: 'Gemini error', 
        status: r.status, 
        message: errorMsg,
        body: txt 
      });
    }
    
    const j = await r.json();
    console.log('✅ Gemini API Success');
    
    const text = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0]
      ? j.candidates[0].content.parts[0].text
      : '';
    return res.json({ text });
  } catch (err) {
    console.error('❌ Gemini proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🌐 AQ-Vision server running at http://localhost:' + PORT);
  console.log('='.repeat(60));
  console.log('\n🔑 Environment Check:');
  console.log('  OPENWEATHER_API_KEY:', OPENWEATHER_API_KEY ? '✅ Set (' + OPENWEATHER_API_KEY.length + ' chars)' : '❌ Missing');
  console.log('  AIRNOW_API_KEY:     ', AIRNOW_API_KEY ? '✅ Set (' + AIRNOW_API_KEY.length + ' chars)' : '❌ Missing');
  console.log('  GOOGLE_MAPS_API_KEY:', GOOGLE_MAPS_API_KEY ? '✅ Set (' + GOOGLE_MAPS_API_KEY.length + ' chars)' : '❌ Missing');
  console.log('  GEMINI_API_KEY:     ', GEMINI_API_KEY ? '✅ Set (' + GEMINI_API_KEY.length + ' chars)' : '❌ Missing');
  console.log('\n🚦 Ready to accept requests!\n');
});