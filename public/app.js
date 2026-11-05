// Client-Side Application Logic (Vanilla JS & REST API Integration)

// Global State
let currentUser = null;
let equipmentList = [];
let reservationsList = [];
let supabaseClient = null;

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  fetchInitialData();
  initializeSupabaseAuth();
});

// Fetch initial data from backend API (with fallback to initial mock state)
async function fetchInitialData() {
  try {
    const eqRes = await fetch('/api/equipment');
    if (eqRes.ok) equipmentList = await eqRes.json();

    const resRes = await fetch('/api/reservations');
    if (resRes.ok) reservationsList = await resRes.json();
  } catch (err) {
    console.warn('Backend server not connected. Running in client-side preview mode.');
  }
}

// --- AUTHENTICATION HANDLERS ---
async function initializeSupabaseAuth() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.message || 'Supabase is not configured.');
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('The Supabase client could not be loaded. Restart the app and reload this page.');
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    const authError = hashParams.get('error_description') || queryParams.get('error_description');
    if (authError) {
      setAuthNotice(authError.replace(/\+/g, ' '), 'error');
      return;
    }

    if (queryParams.get('flow') === 'reset' || hashParams.get('type') === 'recovery') {
      showPasswordUpdate();
      return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session) {
      const profile = await postAuthRequest('/api/auth/profile', {}, data.session.access_token);
      currentUser = profile.user;
      setupUserSession();
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    setAuthNotice('Faculty and staff accounts are provided by the administrator. Use the ID and password issued to you.', '');
  } catch (err) {
    setAuthNotice(err.message || 'Unable to connect to Supabase. Check the app configuration.', 'error');
  }
}

function switchAuthTab(type) {
  const tabSignin = document.getElementById('tabSignin');
  const tabSignup = document.getElementById('tabSignup');
  const tabs = document.getElementById('authTabs');
  const signinPanel = document.getElementById('signinPanel');
  const signupPanel = document.getElementById('signupPanel');
  const isSignin = type === 'signin';

  tabs.classList.remove('hidden');
  tabSignin.classList.toggle('active', isSignin);
  tabSignup.classList.toggle('active', !isSignin);
  tabSignin.setAttribute('aria-selected', String(isSignin));
  tabSignup.setAttribute('aria-selected', String(!isSignin));
  signinPanel.classList.toggle('hidden', !isSignin);
  signupPanel.classList.toggle('hidden', isSignin);
  document.getElementById('passwordResetRequestPanel').classList.add('hidden');
  document.getElementById('passwordUpdatePanel').classList.add('hidden');
  setAuthNotice(isSignin
    ? 'Faculty and staff accounts are provided by the administrator. Use the ID and password issued to you.'
    : 'Student accounts only. Faculty and staff should contact the administrator for their account.', '');
}

function showPasswordReset() {
  document.getElementById('authTabs').classList.add('hidden');
  document.getElementById('signinPanel').classList.add('hidden');
  document.getElementById('signupPanel').classList.add('hidden');
  document.getElementById('passwordUpdatePanel').classList.add('hidden');
  document.getElementById('passwordResetRequestPanel').classList.remove('hidden');
  const identifier = document.getElementById('authIdentifier').value.trim();
  document.getElementById('resetEmail').value = identifier.includes('@') ? identifier : '';
  setAuthNotice('', '');
}

function showPasswordUpdate() {
  document.getElementById('authTabs').classList.add('hidden');
  document.getElementById('signinPanel').classList.add('hidden');
  document.getElementById('signupPanel').classList.add('hidden');
  document.getElementById('passwordResetRequestPanel').classList.add('hidden');
  document.getElementById('passwordUpdatePanel').classList.remove('hidden');
  setAuthNotice('Enter a new password for your account.', '');
}

function returnToSignIn() {
  switchAuthTab('signin');
}

function setAuthNotice(message, type) {
  const notice = document.getElementById('authNotice');
  notice.textContent = message;
  notice.className = `auth-notice${type ? ` ${type}` : ''}`;
}

async function postAuthRequest(path, payload, accessToken) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error('Cannot reach the app server. Start it with "npm start" from the project folder, then reload this page.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('The server returned a web page instead of an authentication response. Start the app with "npm start" and open the URL shown in the terminal.');
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('The server sent an unreadable authentication response. Please restart the app and try again.');
  }

  if (!response.ok) {
    throw new Error(data.message || 'The request could not be completed.');
  }

  return data;
}

async function handleSignIn(e) {
  e.preventDefault();
  if (!supabaseClient) {
    setAuthNotice('Supabase is not ready. Check its configuration and reload the page.', 'error');
    return;
  }

  const identifier = document.getElementById('authIdentifier').value.trim();
  const password = document.getElementById('authPassword').value;
  const button = document.getElementById('btnSignIn');

  button.disabled = true;
  setAuthNotice('Signing in...', '');
  try {
    const data = await postAuthRequest('/api/auth/login', { identifier, password });
    const { error } = await supabaseClient.auth.setSession(data.session);
    if (error) throw error;
    currentUser = data.user;
    setupUserSession();
  } catch (err) {
    setAuthNotice(err.message || 'Unable to sign in. Please try again.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function handleStudentSignUp(e) {
  e.preventDefault();
  if (!supabaseClient) {
    setAuthNotice('Supabase is not ready. Check its configuration and reload the page.', 'error');
    return;
  }

  const button = document.getElementById('btnSignUp');
  const email = document.getElementById('signupEmail').value.trim().toLowerCase();
  const payload = {
    name: document.getElementById('signupName').value.trim(),
    idNumber: document.getElementById('signupId').value.trim(),
    email,
    password: document.getElementById('signupPassword').value
  };

  button.disabled = true;
  setAuthNotice('Creating your student account...', '');
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: { full_name: payload.name, id_number: payload.idNumber },
        emailRedirectTo: `${window.location.origin}/`
      }
    });
    if (error) throw error;

    document.getElementById('signupPanel').reset();
    switchAuthTab('signin');
    if (data.session) {
      const profile = await postAuthRequest('/api/auth/profile', {}, data.session.access_token);
      currentUser = profile.user;
      setupUserSession();
    } else {
      document.getElementById('authIdentifier').value = payload.idNumber;
      setAuthNotice('Account created. Check your email and confirm your address before signing in.', 'success');
    }
  } catch (err) {
    setAuthNotice(err.message || 'Unable to create your account. Please try again.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function handlePasswordResetRequest(e) {
  e.preventDefault();
  if (!supabaseClient) {
    setAuthNotice('Supabase is not ready. Check its configuration and reload the page.', 'error');
    return;
  }

  const email = document.getElementById('resetEmail').value.trim().toLowerCase();
  const button = document.getElementById('btnRequestReset');
  button.disabled = true;
  setAuthNotice('Sending password reset email...', '');
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/?flow=reset`
    });
    if (error) throw error;
    setAuthNotice('If an account exists for this email, a password reset link has been sent. If you do not receive one, check the email address or the email does not exist.', 'success');
  } catch (err) {
    setAuthNotice(err.message || 'Unable to send the reset email. Please try again.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function handlePasswordUpdate(e) {
  e.preventDefault();
  if (!supabaseClient) {
    setAuthNotice('Supabase is not ready. Check its configuration and reload the page.', 'error');
    return;
  }

  const button = document.getElementById('btnUpdatePassword');
  const password = document.getElementById('newPassword').value;
  button.disabled = true;
  setAuthNotice('Updating your password...', '');
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    await supabaseClient.auth.signOut();
    document.getElementById('passwordUpdatePanel').reset();
    window.history.replaceState({}, document.title, window.location.pathname);
    switchAuthTab('signin');
    setAuthNotice('Password updated. Sign in with your new password.', 'success');
  } catch (err) {
    setAuthNotice(err.message || 'Unable to update your password. Request a new reset link.', 'error');
  } finally {
    button.disabled = false;
  }
}

function setupUserSession() {
  document.getElementById('authContainer').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');

  document.getElementById('userDisplayName').innerText = currentUser.name;
  const roleBadge = document.getElementById('userRoleBadge');
  roleBadge.innerText = currentUser.role;
  roleBadge.className = `role-pill ${currentUser.role.toLowerCase()}`;

  const studentNav = document.getElementById('studentNav');
  const adminNav = document.getElementById('adminNav');

  if (currentUser.role === 'STUDENT') {
    studentNav.classList.remove('hidden');
    adminNav.classList.add('hidden');
    switchDashboardTab('catalog');
  } else {
    adminNav.classList.remove('hidden');
    studentNav.classList.add('hidden');
    switchDashboardTab('approvals');
  }
}

async function logout() {
  if (supabaseClient) {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      alert(`Unable to sign out: ${error.message}`);
      return;
    }
  }

  currentUser = null;
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('authContainer').classList.remove('hidden');
}

// --- TAB SWITCHING LOGIC ---
function switchDashboardTab(tabName) {
  // Hide all sections
  const sections = ['secCatalog', 'secMyReservations', 'secApprovals', 'secInventory', 'secAllLogs'];
  sections.forEach(s => document.getElementById(s).classList.add('hidden'));

  // Remove active styling from nav buttons
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => btn.classList.remove('active'));

  if (tabName === 'catalog') {
    document.getElementById('secCatalog').classList.remove('hidden');
    document.getElementById('navCatalog').classList.add('active');
    renderCatalog();
  } else if (tabName === 'my-reservations') {
    document.getElementById('secMyReservations').classList.remove('hidden');
    document.getElementById('navMyReservations').classList.add('active');
    renderMyReservations();
  } else if (tabName === 'approvals') {
    document.getElementById('secApprovals').classList.remove('hidden');
    document.getElementById('navApprovals').classList.add('active');
    renderApprovals();
  } else if (tabName === 'inventory') {
    document.getElementById('secInventory').classList.remove('hidden');
    document.getElementById('navInventory').classList.add('active');
    renderInventory();
  } else if (tabName === 'all-logs') {
    document.getElementById('secAllLogs').classList.remove('hidden');
    document.getElementById('navAllLogs').classList.add('active');
    renderMasterLog();
  }
}

// --- STUDENT CATALOG RENDER ---
function renderCatalog() {
  const grid = document.getElementById('equipmentGrid');
  const search = document.getElementById('catalogSearch').value.toLowerCase();
  const category = document.getElementById('catalogCategory').value;

  const filtered = equipmentList.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search) || item.labLocation.toLowerCase().includes(search);
    const matchesCategory = category === 'ALL' || item.category === category;
    return matchesSearch && matchesCategory;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="grid-column: 1/-1; color: var(--text-muted);">No hardware equipment found matching your criteria.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(item => `
    <div class="card">
      <div>
        <div class="card-category">${item.category}</div>
        <h3 class="card-title">${item.name}</h3>
        <p class="card-location">📍 ${item.labLocation}</p>
      </div>
      <div class="card-footer">
        <span class="stock-indicator ${item.availableQty > 0 ? 'in-stock' : 'low-stock'}">
          ${item.availableQty} / ${item.totalQty} Available
        </span>
        <button class="btn-primary btn-sm" ${item.availableQty === 0 ? 'disabled' : ''} onclick="openBookingModal('${item.id}')">
          ${item.availableQty > 0 ? 'Book Item' : 'Out of Stock'}
        </button>
      </div>
    </div>
  `).join('');
}

// --- MY RESERVATIONS RENDER ---
function renderMyReservations() {
  const tbody = document.getElementById('tblMyReservations');
  const myRes = reservationsList.filter(r => r.userId === currentUser.id);

  if (myRes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">No reservation requests submitted yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = myRes.map(r => `
    <tr>
      <td><strong>${r.id}</strong></td>
      <td>${r.equipmentName}</td>
      <td>${r.qty}</td>
      <td>${r.reservationDate}</td>
      <td>${r.timeSlot}</td>
      <td><span class="status-badge ${r.status.toLowerCase()}">${r.status}</span></td>
      <td>${r.remarks || '-'}</td>
      <td>
        ${r.status === 'Pending' ? `<button class="btn-danger btn-sm" onclick="cancelReservation('${r.id}')">Cancel</button>` : '-'}
      </td>
    </tr>
  `).join('');
}

// --- STAFF APPROVALS RENDER ---
function renderApprovals() {
  const tbody = document.getElementById('tblApprovals');
  const pending = reservationsList.filter(r => r.status === 'Pending');

  if (pending.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">No pending requests awaiting approval.</td></tr>`;
    return;
  }

  tbody.innerHTML = pending.map(r => `
    <tr>
      <td><strong>${r.id}</strong></td>
      <td>${r.userName}</td>
      <td>${r.equipmentName}</td>
      <td>${r.qty}</td>
      <td>${r.reservationDate}<br><small>${r.timeSlot}</small></td>
      <td>${r.purpose}</td>
      <td>
        <button class="btn-success btn-sm" onclick="openRemarksModal('${r.id}', 'Approved')">Approve</button>
        <button class="btn-danger btn-sm" onclick="openRemarksModal('${r.id}', 'Rejected')">Reject</button>
      </td>
    </tr>
  `).join('');
}

// --- STAFF INVENTORY RENDER ---
function renderInventory() {
  const tbody = document.getElementById('tblInventory');
  tbody.innerHTML = equipmentList.map(e => `
    <tr>
      <td><strong>${e.id}</strong></td>
      <td>${e.name}</td>
      <td>${e.category}</td>
      <td>${e.labLocation}</td>
      <td>${e.availableQty} / ${e.totalQty}</td>
      <td><span class="status-badge approved">${e.status}</span></td>
      <td>
        <div class="inventory-actions">
          <button class="btn-primary btn-sm" onclick="openEditInventoryModal('${e.id}')">Edit</button>
          <button class="btn-danger btn-sm" onclick="deleteEquipment('${e.id}')">Remove</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// --- MASTER LOG RENDER ---
function renderMasterLog() {
  const tbody = document.getElementById('tblMasterLog');
  tbody.innerHTML = reservationsList.map(r => `
    <tr>
      <td><strong>${r.id}</strong></td>
      <td>${r.userName}</td>
      <td>${r.equipmentName}</td>
      <td>${r.qty}</td>
      <td>${r.reservationDate}</td>
      <td><span class="status-badge ${r.status.toLowerCase()}">${r.status}</span></td>
      <td>${r.remarks || '-'}</td>
    </tr>
  `).join('');
}

// --- MODAL HANDLERS & ACTIONS ---
function openBookingModal(eqId) {
  const item = equipmentList.find(e => e.id === eqId);
  if (!item) return;

  document.getElementById('modalEqId').value = item.id;
  document.getElementById('modalEqName').innerText = `Reserve ${item.name}`;
  document.getElementById('modalEqCategory').value = item.category;
  document.getElementById('bookingModal').classList.remove('hidden');
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const eqId = document.getElementById('modalEqId').value;
  const qty = document.getElementById('modalBookingQty').value;
  const reservationDate = document.getElementById('modalBookingDate').value;
  const timeSlot = document.getElementById('modalBookingSlot').value;
  const purpose = document.getElementById('modalBookingPurpose').value;

  const eq = equipmentList.find(e => e.id === eqId);

  const newRes = {
    id: `RES-${Math.floor(1000 + Math.random() * 9000)}`,
    userId: currentUser.id,
    userName: currentUser.name,
    equipmentId: eqId,
    equipmentName: eq.name,
    qty: parseInt(qty),
    reservationDate,
    timeSlot,
    purpose,
    status: 'Pending',
    remarks: 'Awaiting faculty approval'
  };

  try {
    await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRes)
    });
  } catch (err) { console.warn(err); }

  reservationsList.push(newRes);
  closeModal('bookingModal');
  alert('Reservation request submitted successfully!');
  switchDashboardTab('my-reservations');
}

function openRemarksModal(resId, action) {
  document.getElementById('remarksResId').value = resId;
  document.getElementById('remarksActionType').value = action;
  document.getElementById('remarksModalTitle').innerText = `${action} Reservation`;
  document.getElementById('btnSubmitRemarks').className = action === 'Approved' ? 'btn-primary' : 'btn-danger';
  document.getElementById('remarksModal').classList.remove('hidden');
}

async function handleRemarksSubmit(e) {
  e.preventDefault();
  const resId = document.getElementById('remarksResId').value;
  const action = document.getElementById('remarksActionType').value;
  const remarks = document.getElementById('modalRemarksText').value;

  const resItem = reservationsList.find(r => r.id === resId);
  if (resItem) {
    resItem.status = action;
    resItem.remarks = remarks;

    if (action === 'Approved') {
      const eq = equipmentList.find(e => e.id === resItem.equipmentId);
      if (eq) eq.availableQty -= resItem.qty;
    }
  }

  try {
    await fetch(`/api/reservations/${resId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: action, remarks })
    });
  } catch (err) { console.warn(err); }

  closeModal('remarksModal');
  renderApprovals();
}

async function cancelReservation(resId) {
  if (!confirm('Are you sure you want to cancel this pending reservation?')) return;

  reservationsList = reservationsList.filter(r => r.id !== resId);

  try {
    await fetch(`/api/reservations/${resId}`, { method: 'DELETE' });
  } catch (err) { console.warn(err); }

  renderMyReservations();
}

function openAddInventoryModal() {
  document.getElementById('inventoryForm').reset();
  document.getElementById('inventoryId').value = '';
  document.getElementById('inventoryModalTitle').innerText = 'Add New Hardware Asset';
  document.getElementById('invTotalQty').value = 10;
  document.getElementById('btnSaveInventory').innerText = 'Save to Inventory';
  document.getElementById('inventoryModal').classList.remove('hidden');
}

function openEditInventoryModal(eqId) {
  const item = equipmentList.find(e => e.id === eqId);
  if (!item) return;

  document.getElementById('inventoryId').value = item.id;
  document.getElementById('invName').value = item.name;
  document.getElementById('invCategory').value = item.category;
  document.getElementById('invTotalQty').value = item.totalQty;
  document.getElementById('invLocation').value = item.labLocation;
  document.getElementById('inventoryModalTitle').innerText = 'Edit Hardware Asset';
  document.getElementById('btnSaveInventory').innerText = 'Save Changes';
  document.getElementById('inventoryModal').classList.remove('hidden');
}

async function handleInventorySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('inventoryId').value;
  const name = document.getElementById('invName').value.trim();
  const category = document.getElementById('invCategory').value;
  const totalQty = Number.parseInt(document.getElementById('invTotalQty').value, 10);
  const labLocation = document.getElementById('invLocation').value.trim();
  const button = document.getElementById('btnSaveInventory');
  button.disabled = true;
  try {
    const response = await fetch(id ? `/api/equipment/${encodeURIComponent(id)}` : '/api/equipment', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, totalQty, labLocation })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to save equipment.');

    const savedEquipment = data.equipment;
    if (id) {
      equipmentList = equipmentList.map(item => item.id === id ? savedEquipment : item);
    } else {
      equipmentList.push(savedEquipment);
    }

    closeModal('inventoryModal');
    renderInventory();
  } catch (err) {
    alert(err.message || 'Unable to save equipment. Please try again.');
  } finally {
    button.disabled = false;
  }
}

async function deleteEquipment(eqId) {
  if (!confirm('Are you sure you want to delete this equipment item from inventory?')) return;

  equipmentList = equipmentList.filter(e => e.id !== eqId);

  try {
    await fetch(`/api/equipment/${eqId}`, { method: 'DELETE' });
  } catch (err) { console.warn(err); }

  renderInventory();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}
