import jwt from 'jsonwebtoken';

const JWT_SECRET = 'rateshield-jwt-secret-2024';
const JWT_EXPIRES_IN = '24h';
let nextId = 1;

const users = [
  { id: 1, username: 'demo', password: 'password', created: Date.now() }
];
nextId = 2;

export const registerUser = (username, password) => {
  if (users.find(u => u.username === username)) {
    return { error: 'Username already exists' };
  }
  const id = nextId++;
  const user = { id, username, password, created: Date.now() };
  users.push(user);
  return issueToken(user);
};

export const loginUser = (username, password) => {
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return { error: 'Invalid username or password' };
  return issueToken(user);
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

function issueToken(user) {
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  return { token, user: { id: user.id, username: user.username, created: user.created } };
}
