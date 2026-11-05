const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const projectEnvPath = path.join(__dirname, '.env');
const workspaceEnvLocalPath = path.join(__dirname, '..', '.env.local');
require('dotenv').config({
  path: fs.existsSync(projectEnvPath) ? projectEnvPath : workspaceEnvLocalPath
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd')));
app.use(express.static(path.join(__dirname, 'public')));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  : null;
const reservationSelect = 'id, user_id, equipment_id, qty, reservation_date, time_slot, purpose, status, remarks, created_at, users!inner(full_name, email), equipment!inner(name)';

function createSupabaseAuthClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

function toPublicUser(profile) {
  return {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
    idNumber: profile.id_number,
    email: profile.email
  };
}

async function findUserProfile(identifier) {
  if (!supabaseAdmin) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  }

  const isEmail = identifier.includes('@');
  const column = isEmail ? 'email' : 'id_number';
  const value = isEmail ? identifier.toLowerCase() : identifier;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, id_number, full_name, email, role')
    .eq(column, value)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireSession(req, res, next) {
  const authorization = req.get('authorization') || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const authClient = createSupabaseAuthClient();
  if (!accessToken) {
    return res.status(401).json({ success: false, message: 'Your session is invalid. Please sign in again.' });
  }
  if (!authClient || !supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not fully configured on the server.' });
  }

  authClient.auth.getUser(accessToken)
    .then(({ data, error }) => {
      if (error || !data.user) {
        return res.status(401).json({ success: false, message: 'Your session is invalid. Please sign in again.' });
      }

      return supabaseAdmin
        .from('users')
        .select('id, auth_user_id, id_number, full_name, email, role')
        .eq('auth_user_id', data.user.id)
        .maybeSingle()
        .then(({ data: profile, error: profileError }) => {
          if (profileError) {
            console.error('Supabase profile lookup failed:', profileError.message);
            return res.status(503).json({ success: false, message: 'Unable to load your account profile.' });
          }
          if (!profile) {
            return res.status(403).json({ success: false, message: 'Your account profile is not set up. Contact the administrator.' });
          }

          req.profile = profile;
          req.authUser = data.user;
          next();
        });
    })
    .catch(error => {
      console.error('Supabase session validation failed:', error.message);
      res.status(503).json({ success: false, message: 'Unable to validate your session.' });
    });
}

function requireStaff(req, res, next) {
  if (req.profile.role === 'STUDENT') {
    return res.status(403).json({ success: false, message: 'Only faculty and administrators can perform this action.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.profile.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Only administrators can perform this action.' });
  }
  next();
}

function toPublicEquipment(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    totalQty: row.total_qty,
    availableQty: row.available_qty,
    labLocation: row.lab_location,
    status: row.status
  };
}

function toPublicReservation(row) {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const item = Array.isArray(row.equipment) ? row.equipment[0] : row.equipment;
  return {
    id: row.id,
    userId: row.user_id,
    userName: user.full_name,
    equipmentId: row.equipment_id,
    equipmentName: item.name,
    qty: row.qty,
    reservationDate: row.reservation_date,
    timeSlot: row.time_slot,
    purpose: row.purpose,
    status: row.status,
    remarks: row.remarks,
    createdAt: row.created_at
  };
}

function createReservationId() {
  return `RES-${randomBytes(8).toString('hex').toUpperCase()}`;
}

// --- AUTH ROUTES ---
app.get('/api/config', (req, res) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({
      success: false,
      message: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env, then restart the app.'
    });
  }

  res.json({ supabaseUrl, supabaseAnonKey });
});

app.post('/api/auth/login', (req, res) => {
  const body = req.body || {};
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const { password } = body;

  if (!identifier || typeof password !== 'string' || !password || password.length > 128) {
    return res.status(400).json({ success: false, message: 'Enter your ID or email and password.' });
  }

  const authClient = createSupabaseAuthClient();
  if (!authClient || !supabaseAdmin) {
    return res.status(503).json({
      success: false,
      message: 'Supabase is not fully configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.'
    });
  }

  findUserProfile(identifier)
    .then(async profile => {
      if (!profile || !profile.auth_user_id) {
        return res.status(401).json({ success: false, message: 'The ID/email or password is incorrect.' });
      }

      const { data, error } = await authClient.auth.signInWithPassword({
        email: profile.email,
        password
      });

      if (error) {
        const message = error.code === 'email_not_confirmed'
          ? 'Please confirm your email address before signing in.'
          : 'The ID/email or password is incorrect.';
        return res.status(401).json({ success: false, message });
      }

      res.json({
        success: true,
        user: toPublicUser(profile),
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        }
      });
    })
    .catch(error => {
      console.error('Supabase sign-in failed:', error.message);
      res.status(503).json({
        success: false,
        message: 'Unable to check your account in Supabase. Verify the database setup and server configuration.'
      });
    });
});

app.post('/api/auth/profile', async (req, res) => {
  const authorization = req.get('authorization') || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const authClient = createSupabaseAuthClient();

  if (!accessToken || !authClient || !supabaseAdmin) {
    return res.status(401).json({ success: false, message: 'Your session is invalid. Please sign in again.' });
  }

  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return res.status(401).json({ success: false, message: 'Your session is invalid. Please sign in again.' });
  }

  const { data: profile, error } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, id_number, full_name, email, role')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (error) {
    console.error('Supabase profile lookup failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to load your account profile.' });
  }
  if (!profile) {
    return res.status(403).json({ success: false, message: 'Your account profile is not set up. Contact the administrator.' });
  }

  res.json({ success: true, user: toPublicUser(profile) });
});

app.post('/api/admin/users', requireSession, requireAdmin, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const idNumber = typeof body.idNumber === 'string' ? body.idNumber.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role;

  if (
    !name || name.length > 100 ||
    !idNumber || idNumber.length > 50 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100 ||
    password.length < 8 || password.length > 128 ||
    !['STUDENT', 'INSTRUCTOR'].includes(role)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid name, ID, email, student/faculty role, and password between 8 and 128 characters.'
    });
  }

  const { data: emailProfile, error: emailLookupError } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (emailLookupError) {
    console.error('Supabase user email lookup failed:', emailLookupError.message);
    return res.status(503).json({ success: false, message: 'Unable to verify whether this email is already in use.' });
  }
  if (emailProfile) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
  }

  const { data: idProfile, error: idLookupError } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id_number', idNumber)
    .maybeSingle();
  if (idLookupError) {
    console.error('Supabase user ID lookup failed:', idLookupError.message);
    return res.status(503).json({ success: false, message: 'Unable to verify whether this ID is already in use.' });
  }
  if (idProfile) {
    return res.status(409).json({ success: false, message: 'This student/faculty ID is already in use.' });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, id_number: idNumber }
  });
  if (createError || !created.user) {
    if (createError?.status === 422 || createError?.code === 'email_exists') {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    console.error('Supabase admin account creation failed:', createError?.message || 'Supabase returned no user.');
    return res.status(503).json({ success: false, message: 'Unable to create the account in Supabase.' });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .update({ full_name: name, id_number: idNumber, email, role })
    .eq('auth_user_id', created.user.id)
    .select('id, id_number, full_name, email, role')
    .maybeSingle();

  if (profileError || !profile) {
    const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    if (cleanupError) {
      console.error('Supabase account rollback failed:', cleanupError.message);
      return res.status(503).json({
        success: false,
        message: 'The login account was created, but its profile could not be set up or rolled back. Contact the administrator.'
      });
    }
    console.error('Supabase account profile setup failed:', profileError?.message || 'Auth profile trigger did not create a profile.');
    return res.status(503).json({ success: false, message: 'Unable to finish setting up the account. The incomplete login was removed.' });
  }

  res.status(201).json({
    success: true,
    user: {
      idNumber: profile.id_number,
      name: profile.full_name,
      email: profile.email,
      role: profile.role
    }
  });
}));

// --- EQUIPMENT ROUTES (CRUD) ---
// READ: Get all equipment
app.get('/api/equipment', asyncRoute(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const { data, error } = await supabaseAdmin
    .from('equipment')
    .select('id, name, category, total_qty, available_qty, lab_location, status')
    .order('name');
  if (error) {
    console.error('Supabase equipment lookup failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to load equipment from the database.' });
  }
  res.json(data.map(toPublicEquipment));
}));

// CREATE: Add new equipment (Admin)
app.post('/api/equipment', requireSession, requireAdmin, asyncRoute(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const labLocation = typeof body.labLocation === 'string' ? body.labLocation.trim() : '';
  const totalQty = Number(body.totalQty);
  if (!name || !category || !labLocation || !Number.isInteger(totalQty) || totalQty < 1) {
    return res.status(400).json({ success: false, message: 'Enter valid equipment details and a total quantity of at least 1.' });
  }

  const row = {
    id: `EQ-${randomBytes(5).toString('hex').toUpperCase()}`,
    name,
    category,
    total_qty: totalQty,
    available_qty: totalQty,
    lab_location: labLocation,
    status: 'Available'
  };
  const { data, error } = await supabaseAdmin
    .from('equipment')
    .insert(row)
    .select('id, name, category, total_qty, available_qty, lab_location, status')
    .single();
  if (error) {
    console.error('Supabase equipment creation failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to add equipment to the database.' });
  }
  res.status(201).json({ success: true, equipment: toPublicEquipment(data) });
}));

// UPDATE: Edit equipment (Admin)
app.put('/api/equipment/:id', requireSession, requireAdmin, asyncRoute(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const labLocation = typeof body.labLocation === 'string' ? body.labLocation.trim() : '';
  const totalQty = Number(body.totalQty);
  if (!name || !category || !labLocation || !Number.isInteger(totalQty) || totalQty < 1) {
    return res.status(400).json({
      success: false,
      message: 'Enter valid equipment details and a total quantity of at least 1.'
    });
  }

  const { data: current, error: lookupError } = await supabaseAdmin
    .from('equipment')
    .select('total_qty, available_qty, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (lookupError) {
    console.error('Supabase equipment lookup failed:', lookupError.message);
    return res.status(503).json({ success: false, message: 'Unable to load the equipment item.' });
  }
  if (!current) return res.status(404).json({ success: false, message: 'Item not found.' });

  const checkedOutQty = current.total_qty - current.available_qty;
  if (totalQty < checkedOutQty) {
    return res.status(400).json({
      success: false,
      message: `Total quantity cannot be less than ${checkedOutQty}; that many item(s) are currently checked out.`
    });
  }

  const { data, error } = await supabaseAdmin
    .from('equipment')
    .update({
      name,
      category,
      total_qty: totalQty,
      available_qty: totalQty - checkedOutQty,
      lab_location: labLocation,
      status: current.status === 'Maintenance'
        ? 'Maintenance'
        : (totalQty === checkedOutQty ? 'Depleted' : 'Available')
    })
    .eq('id', req.params.id)
    .select('id, name, category, total_qty, available_qty, lab_location, status')
    .maybeSingle();
  if (error) {
    console.error('Supabase equipment update failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to update equipment in the database.' });
  }
  if (!data) return res.status(404).json({ success: false, message: 'Item not found.' });
  res.json({ success: true, equipment: toPublicEquipment(data) });
}));

// DELETE: Remove equipment only when it has no reservation history.
app.delete('/api/equipment/:id', requireSession, requireAdmin, asyncRoute(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const { count, error: reservationError } = await supabaseAdmin
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('equipment_id', req.params.id);
  if (reservationError) {
    console.error('Supabase reservation lookup failed:', reservationError.message);
    return res.status(503).json({ success: false, message: 'Unable to verify equipment reservation history.' });
  }
  if (count > 0) {
    return res.status(409).json({ success: false, message: 'Equipment with reservation history cannot be removed.' });
  }

  const { data, error } = await supabaseAdmin
    .from('equipment')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Supabase equipment deletion failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to remove equipment from the database.' });
  }
  if (!data) return res.status(404).json({ success: false, message: 'Item not found.' });
  res.json({ success: true, message: 'Equipment removed successfully.' });
}));

// --- RESERVATIONS ROUTES (CRUD) ---
// Students can see their reservations; faculty/admin can see all.
app.get('/api/reservations', requireSession, asyncRoute(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  let query = supabaseAdmin
    .from('reservations')
    .select(reservationSelect)
    .order('created_at', { ascending: false });
  if (req.profile.role === 'STUDENT') {
    query = query.eq('user_id', req.profile.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Supabase reservation lookup failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to load reservations from the database.' });
  }
  res.json(data.map(toPublicReservation));
}));

// CREATE: Submit a reservation for the authenticated student.
app.post('/api/reservations', requireSession, asyncRoute(async (req, res) => {
  if (req.profile.role !== 'STUDENT') {
    return res.status(403).json({ success: false, message: 'Only students can submit reservations.' });
  }
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const body = req.body || {};
  const equipmentId = typeof body.equipmentId === 'string' ? body.equipmentId : '';
  const qty = Number(body.qty);
  const reservationDate = typeof body.reservationDate === 'string' ? body.reservationDate : '';
  const timeSlot = typeof body.timeSlot === 'string' ? body.timeSlot.trim() : '';
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  if (!equipmentId || !Number.isInteger(qty) || qty < 1 || !reservationDate || !timeSlot || !purpose) {
    return res.status(400).json({ success: false, message: 'Enter valid equipment, quantity, date, time slot, and purpose.' });
  }

  const { data: item, error: equipmentError } = await supabaseAdmin
    .from('equipment')
    .select('id, available_qty')
    .eq('id', equipmentId)
    .maybeSingle();
  if (equipmentError) {
    console.error('Supabase equipment lookup failed:', equipmentError.message);
    return res.status(503).json({ success: false, message: 'Unable to check equipment availability.' });
  }
  if (!item) return res.status(404).json({ success: false, message: 'Equipment not found.' });
  if (item.available_qty < qty) {
    return res.status(400).json({ success: false, message: 'Insufficient stock available.' });
  }

  const { data, error } = await supabaseAdmin
    .from('reservations')
    .insert({
      id: createReservationId(),
      user_id: req.profile.id,
      equipment_id: item.id,
      qty,
      reservation_date: reservationDate,
      time_slot: timeSlot,
      purpose,
      status: 'Pending',
      remarks: 'Awaiting faculty approval'
    })
    .select(reservationSelect)
    .single();
  if (error) {
    console.error('Supabase reservation creation failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to save the reservation. Please try again.' });
  }
  res.status(201).json({ success: true, reservation: toPublicReservation(data) });
}));

// UPDATE: Save the faculty decision before sending the student email.
app.patch('/api/reservations/:id', requireSession, requireStaff, asyncRoute(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const body = req.body || {};
  const status = body.status;
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
  if (!['Approved', 'Rejected'].includes(status) || !remarks || remarks.length > 2000) {
    return res.status(400).json({ success: false, message: 'Choose Accepted or Rejected and enter faculty remarks (up to 2000 characters).' });
  }

  const { data: currentReservation, error: lookupError } = await supabaseAdmin
    .from('reservations')
    .select(reservationSelect)
    .eq('id', req.params.id)
    .maybeSingle();
  if (lookupError) {
    console.error('Supabase reservation lookup failed before decision:', lookupError.message);
    return res.status(503).json({ success: false, message: 'Unable to load the reservation.' });
  }
  if (!currentReservation) {
    return res.status(404).json({ success: false, message: 'Reservation not found.' });
  }

  const { error: decisionError } = await supabaseAdmin.rpc('process_reservation_decision', {
    p_reservation_id: req.params.id,
    p_status: status,
    p_remarks: remarks
  });
  if (decisionError) {
    if (decisionError.code === 'P0002') {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    if (decisionError.code === '23514') {
      return res.status(409).json({ success: false, message: decisionError.message });
    }
    console.error('Supabase reservation decision failed:', decisionError.message);
    return res.status(503).json({ success: false, message: 'Unable to save the reservation decision.' });
  }

  const reservation = { ...currentReservation, status, remarks };
  res.json({
    success: true,
    reservation: toPublicReservation(reservation)
  });
}));

// DELETE: Student can cancel only their own pending reservation.
app.delete('/api/reservations/:id', requireSession, asyncRoute(async (req, res) => {
  if (req.profile.role !== 'STUDENT') {
    return res.status(403).json({ success: false, message: 'Only students can cancel reservations.' });
  }
  if (!supabaseAdmin) {
    return res.status(503).json({ success: false, message: 'Supabase is not configured on the server.' });
  }

  const { data, error } = await supabaseAdmin
    .from('reservations')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.profile.id)
    .eq('status', 'Pending')
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Supabase reservation cancellation failed:', error.message);
    return res.status(503).json({ success: false, message: 'Unable to cancel the reservation.' });
  }
  if (!data) {
    return res.status(404).json({ success: false, message: 'Pending reservation not found for this account.' });
  }
  res.json({ success: true, message: 'Reservation cancelled.' });
}));

app.use((error, req, res, next) => {
  console.error('Unhandled API error:', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

// Serve Single Page Application Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export Express app for Vercel Serverless execution
module.exports = app;

// Run standalone server only in local development
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`PRMSU COE Smart Campus Reservation System`);
    console.log(`Server active on port http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}
