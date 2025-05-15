const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');

const serviceAccount = require('./config/key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('login'));

app.get('/signup', (req, res) => res.render('signup'));

app.get('/feedback', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('feedback');
});

app.post('/signup', async (req, res) => {
  const { email, username, password, confirmPassword } = req.body;
  if (password !== confirmPassword) return res.send('Passwords do not match');

  const userDoc = await db.collection('users').doc(email).get();
  if (userDoc.exists) return res.send('User with this email already exists');

  const hashedPassword = await bcrypt.hash(password, 10);

  await db.collection('users').doc(email).set({
    email,
    username,
    password: hashedPassword,
    role: 'user'
  });

  req.session.user = { email, username, role: 'user' };
  res.redirect('/feedback');
});

app.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  let userDoc;
  userDoc = await db.collection('users').doc(identifier).get();

  if (!userDoc.exists) {
    const snapshot = await db.collection('users').where('username', '==', identifier).get();
    if (!snapshot.empty) {
      userDoc = snapshot.docs[0];
    } else {
      return res.send('Invalid credentials');
    }
  }

  const userData = userDoc.data();
  const isPasswordValid = await bcrypt.compare(password, userData.password);
  if (!isPasswordValid) return res.send('Invalid credentials');

  req.session.user = {
    email: userData.email,
    username: userData.username,
    role: userData.role
  };

  if (userData.role === 'admin') {
    res.redirect('/admin');
  } else {
    res.redirect('/feedback');
  }
});

app.post('/feedback', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const { subject, message, anonymous } = req.body;

  await db.collection('feedbacks').add({
    subject,
    message,
    user: anonymous ? 'Anonymous' : req.session.user.username,
    timestamp: new Date()
  });

  res.redirect('/success');
});

app.get('/success', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('success', { username: req.session.user.username });
});

app.get('/admin', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');

  const snapshot = await db.collection('feedbacks').orderBy('timestamp', 'desc').get();
  const feedbacks = snapshot.docs.map(doc => ({
    ...doc.data(),
    id: doc.id
  }));
  res.render('admin', { feedbacks });
});

app.post('/delete-feedback', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
  
  const { feedbackId } = req.body;

  try {
    await db.collection('feedbacks').doc(feedbackId).delete();
    res.redirect('/admin');
  } catch (error) {
    console.log(error);
    res.send('Error deleting feedback');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.send('Error logging out');
    res.redirect('/login');
  });
});

app.listen(3000, () => {
  console.log('Secure Feedback Portal running on http://localhost:3000');
});
