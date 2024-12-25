const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const { createMollieClient } = require('@mollie/api-client');
const morgan = require('morgan');

const app = express();
const PORT = 3000;

// Paths to the files
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');

// Middleware setup
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Session middleware
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Initialize Mollie client
const mollieClient = createMollieClient({ apiKey: 'your_mollie_api_key' }); // Replace with your Mollie API Key

// Helper functions to load and save users/products/orders
const loadData = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error loading data from ${filePath}:`, err);
    return [];
  }
};

const saveData = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error saving data to ${filePath}:`, err);
  }
};

const loadUsers = () => loadData(USERS_FILE);
const saveUsers = (users) => saveData(USERS_FILE, users);
const loadProducts = () => loadData(PRODUCTS_FILE);
const saveProducts = (products) => saveData(PRODUCTS_FILE, products);
const loadOrders = () => loadData(ORDERS_FILE);
const saveOrders = (orders) => saveData(ORDERS_FILE, orders);

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Register a new user
app.post('/register', async (req, res) => {
  try {
    const { username, password, confirmPassword, role = 'customer' } = req.body;
    const users = loadUsers();

    if (users.find(user => user.username === username)) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword, role });
    saveUsers(users);

    res.json({ message: 'Registration successful! You can now log in.' });
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ message: 'Internal server error. Please try again later.' });
  }
});

// Login functionality
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.username === username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: 'Invalid username or password' });
  }

  req.session.user = { username, role: user.role };
  res.json({ success: true, message: 'Login successful!', redirectTo: '/products' });
});

// Middleware for authentication and role-based access
const isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

const isAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

// Serve products page
app.get('/products', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'products.html'));
});

// API to fetch products
app.get('/api/products', isAuthenticated, (req, res) => {
  const products = loadProducts();
  res.json(products);
});

// Admin: Add or update products
app.post('/api/products', isAuthenticated, isAdmin, (req, res) => {
  const { id, name, price, category } = req.body;
  const products = loadProducts();

  const productIndex = products.findIndex(p => p.id === id);
  if (productIndex > -1) {
    products[productIndex] = { id, name, price, category };
  } else {
    products.push({ id, name, price, category });
  }

  saveProducts(products);
  res.json({ message: 'Product saved successfully!' });
});

// Checkout functionality
app.post('/checkout', isAuthenticated, (req, res) => {
  const { products } = req.body;
  const allProducts = loadProducts();
  const selectedProducts = allProducts.filter(p => products.includes(p.id.toString()));

  if (selectedProducts.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid products selected.' });
  }

  const totalPrice = selectedProducts.reduce((sum, product) => sum + product.price, 0);
  const orders = loadOrders();
  orders.push({ username: req.session.user.username, products: selectedProducts, totalPrice });
  saveOrders(orders);

  res.json({ success: true, message: `Checkout successful! Total: $${totalPrice.toFixed(2)}` });
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Could not log out.');
    }
    res.redirect('/login');
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
