console.log('✅ Express app loaded');

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

// .env only for plain-node local; SAM uses env.json
try { require('dotenv').config(); } catch (_) {}

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Mongo connection (fail fast; never hang) ----
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) console.warn('⚠️  MONGO_URI is not set');

let connectingPromise = null;

async function ensureDb() {
  if (!MONGO_URI) throw new Error('MONGO_URI not set');
  if (mongoose.connection.readyState === 1) return true; // already connected
  if (!connectingPromise) {
    connectingPromise = mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000
    }).then(() => {
      console.log('✅ Mongo connected');
      return true;
    }).catch((err) => {
      console.error('❌ Mongo connect failed:', err?.message || err);
      connectingPromise = null; // allow retry on next request
      throw err;
    });
  }
  return connectingPromise;
}

// ---- Schemas & Models ----
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const overrideSchema = new mongoose.Schema({
  lat: String,
  lon: String,
  date: String,
  newValues: Object,
  updatedAt: String,
  updatedBy: String,
  version: Number,
  active: Boolean
});
const Override = mongoose.model('Override', overrideSchema);

// ---- Helpers ----
async function getLatestOverride(lat, lon, date, userEmail) {
  await ensureDb();
  return Override.findOne({ lat, lon, date, active: true, updatedBy: userEmail })
    .sort({ version: -1 }).exec();
}
async function addOverride(lat, lon, date, values, userEmail) {
  await ensureDb();
  const latest = await Override.findOne({ lat, lon, date, updatedBy: userEmail })
    .sort({ version: -1 }).exec();
  const newVersion = latest ? latest.version + 1 : 1;
  await Override.updateMany({ lat, lon, date, updatedBy: userEmail }, { $set: { active: false } });
  const newOverride = new Override({
    lat, lon, date, newValues: values,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail, version: newVersion, active: true
  });
  return newOverride.save();
}
async function removeOverride(lat, lon, date, userEmail) {
  await ensureDb();
  return Override.findOneAndUpdate(
    { lat, lon, date, active: true, updatedBy: userEmail },
    { $set: { active: false } },
    { new: true }
  );
}

// ---- Routes ----
app.get('/', (req, res) => res.json({ status: 'ok', service: 'weatherio' }));

app.get('/health', async (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    await ensureDb();
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'User already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });
    res.status(201).json({ message: 'Registration successful', user: { email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'registration-failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    await ensureDb();
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ message: 'Login successful', user: { email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'login-failed' });
  }
});

app.get('/override', async (req, res) => {
  try {
    const { lat, lon, date, email } = req.query || {};
    const override = await getLatestOverride(lat, lon, date, email);
    res.json(override || {});
  } catch (err) {
    console.error('Get override error:', err);
    res.status(500).json({ error: 'get-override-failed' });
  }
});

app.post('/override', async (req, res) => {
  try {
    const { lat, lon, date, values, email } = req.body || {};
    const newEntry = await addOverride(lat, lon, date, values, email);
    res.status(201).json(newEntry);
  } catch (err) {
    console.error('Add override error:', err);
    res.status(500).json({ error: 'add-override-failed' });
  }
});

app.delete('/override', async (req, res) => {
  try {
    const { lat, lon, date, email } = req.body || {};
    const removed = await removeOverride(lat, lon, date, email);
    res.json({ removed: !!removed });
  } catch (err) {
    console.error('Remove override error:', err);
    res.status(500).json({ error: 'remove-override-failed' });
  }
});

// Optional static pages
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/weather', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 404 & error handlers
app.use((req, res) => res.status(404).json({ error: 'not-found', path: req.path }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal-error' });
});

// IMPORTANT: Do not call app.listen() in Lambda
module.exports = app;
