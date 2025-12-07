// Mock API for testing user management without backend
export const mockUsers = [
  {
    username: 'admin',
    role: 'admin',
    allowed_tabs: ['attendance', 'enrollment', 'labels', 'salesdata', 'magentodata', 'inventory', 'usermanagement']
  },
  {
    username: 'manager',
    role: 'manager', 
    allowed_tabs: ['attendance', 'enrollment', 'labels']
  },
  {
    username: 'user1',
    role: 'user',
    allowed_tabs: ['attendance']
  }
];

let users = [...mockUsers];

// Mock API functions
export const getUsers = () => Promise.resolve(users);

export const createUser = ({ username, password, role = 'user', allowed_tabs = [] }) => {
  // Check if user already exists
  if (users.find(u => u.username === username)) {
    return Promise.reject(new Error('Username already exists'));
  }
  
  const newUser = { username, role, allowed_tabs };
  users.push(newUser);
  return Promise.resolve({ detail: 'created' });
};

export const updateUser = ({ username, new_username, new_password, role, allowed_tabs }) => {
  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex === -1) {
    return Promise.reject(new Error('User not found'));
  }
  
  if (new_username && new_username !== username) {
    // Check if new username already exists
    if (users.find(u => u.username === new_username)) {
      return Promise.reject(new Error('New username already exists'));
    }
    users[userIndex].username = new_username;
  }
  
  if (role) users[userIndex].role = role;
  if (allowed_tabs) users[userIndex].allowed_tabs = allowed_tabs;
  
  return Promise.resolve({ detail: 'updated' });
};

export const deleteUser = (username) => {
  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex === -1) {
    return Promise.reject(new Error('User not found'));
  }
  
  users.splice(userIndex, 1);
  return Promise.resolve({ detail: 'deleted' });
};