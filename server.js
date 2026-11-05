const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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

let equipment = [
  { id: 'EQ-101', name: 'Digital Storage Oscilloscope 100MHz', category: 'Testing Tools', totalQty: 8, availableQty: 6, labLocation: 'Embedded Systems Lab', status: 'Available' },
  { id: 'EQ-102', name: 'PIC16F877A Microcontroller Trainer Kit', category: 'Microcontrollers', totalQty: 15, availableQty: 12, labLocation: 'Hardware Lab 2', status: 'Available' },
  { id: 'EQ-103', name: '8051 Microcontroller Evaluation Board', category: 'Microcontrollers', totalQty: 10, availableQty: 8, labLocation: 'Hardware Lab 1', status: 'Available' },
  { id: 'EQ-104', name: 'Digital Logic Gate Experimenter Kit', category: 'Logic Circuits', totalQty: 20, availableQty: 18, labLocation: 'Digital Circuits Lab', status: 'Available' },
  { id: 'EQ-105', name: 'ESP32 IoT Development Node Kit', category: 'IoT & Edge', totalQty: 25, availableQty: 20, labLocation: 'Embedded Systems Lab', status: 'Available' },
  { id: 'EQ-106', name: 'Handheld True-RMS Digital Multimeter', category: 'Testing Tools', totalQty: 30, availableQty: 25, labLocation: 'General COE Lab', status: 'Available' }
];

let reservations = [
  { id: 'RES-1001', userId: '1', userName: 'Samantha Regalado', equipmentId: 'EQ-101', equipmentName: 'Digital Storage Oscilloscope 100MHz', qty: 1, reservationDate: '2026-11-05', timeSlot: '09:00 AM - 12:00 PM', purpose: 'Digital Signal Processing Lab Activity #4', status: 'Pending', remarks: 'Awaiting faculty approval' },
  { id: 'RES-1002', userId: '1', userName: 'Samantha Regalado', equipmentId: 'EQ-105', equipmentName: 'ESP32 IoT Development Node Kit', qty: 2, reservationDate: '2026-11-03', timeSlot: '01:00 PM - 04:00 PM', purpose: 'Edge-Based Irrigation Capstone Testing', status: 'Approved', remarks: 'Approved. Handle with care.' }
];

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

// --- EQUIPMENT ROUTES (CRUD) ---
// READ: Get all equipment
app.get('/api/equipment', (req, res) => {
  res.json(equipment);
});

// CREATE: Add new equipment (Staff/Admin)
app.post('/api/equipment', (req, res) => {
  const { name, category, totalQty, labLocation } = req.body;
  const newEq = {
    id: `EQ-${Math.floor(100 + Math.random() * 900)}`,
    name,
    category,
    totalQty: parseInt(totalQty),
    availableQty: parseInt(totalQty),
    labLocation,
    status: 'Available'
  };
  equipment.push(newEq);
  res.status(201).json({ success: true, equipment: newEq });
});

// UPDATE: Edit equipment (Staff/Admin)
app.put('/api/equipment/:id', (req, res) => {
  const { id } = req.params;
  const index = equipment.findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Item not found' });

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const labLocation = typeof body.labLocation === 'string' ? body.labLocation.trim() : '';
  const totalQty = Number(body.totalQty);
  if (!name || !category || !labLocation || !Number.isInteger(totalQty) || totalQty < 1) {
    return res.status(400).json({ success: false, message: 'Enter valid equipment details and a total quantity of at least 1.' });
  }

  const currentEquipment = equipment[index];
  const checkedOutQty = currentEquipment.totalQty - currentEquipment.availableQty;
  if (totalQty < checkedOutQty) {
    return res.status(400).json({
      success: false,
      message: `Total quantity cannot be less than ${checkedOutQty}; that many item(s) are currently checked out.`
    });
  }

  equipment[index] = {
    ...currentEquipment,
    name,
    category,
    totalQty,
    availableQty: totalQty - checkedOutQty,
    labLocation,
    status: currentEquipment.status === 'Maintenance'
      ? 'Maintenance'
      : (totalQty === checkedOutQty ? 'Depleted' : 'Available')
  };
  res.json({ success: true, equipment: equipment[index] });
});

// DELETE: Remove equipment (Staff/Admin)
app.delete('/api/equipment/:id', (req, res) => {
  const { id } = req.params;
  equipment = equipment.filter(e => e.id !== id);
  res.json({ success: true, message: 'Equipment removed successfully' });
});

// --- RESERVATIONS ROUTES (CRUD) ---
// READ: Get all or user-specific reservations
app.get('/api/reservations', (req, res) => {
  const { userId } = req.query;
  if (userId) {
    const userRes = reservations.filter(r => r.userId === userId);
    return res.json(userRes);
  }
  res.json(reservations);
});

// CREATE: Submit new reservation request (Student)
app.post('/api/reservations', (req, res) => {
  const { userId, userName, equipmentId, qty, reservationDate, timeSlot, purpose } = req.body;
  
  const eq = equipment.find(e => e.id === equipmentId);
  if (!eq) return res.status(404).json({ success: false, message: 'Equipment not found' });
  if (eq.availableQty < qty) return res.status(400).json({ success: false, message: 'Insufficient stock available' });

  const newReservation = {
    id: `RES-${Math.floor(1000 + Math.random() * 9000)}`,
    userId,
    userName,
    equipmentId,
    equipmentName: eq.name,
    qty: parseInt(qty),
    reservationDate,
    timeSlot,
    purpose,
    status: 'Pending',
    remarks: 'Awaiting faculty approval'
  };

  reservations.push(newReservation);
  res.status(201).json({ success: true, reservation: newReservation });
});

// UPDATE: Change status / remarks (Staff/Admin)
app.patch('/api/reservations/:id', (req, res) => {
  const { id } = req.params;
  const { status, remarks } = req.body;
  
  const resItem = reservations.find(r => r.id === id);
  if (!resItem) return res.status(404).json({ success: false, message: 'Reservation not found' });

  resItem.status = status;
  if (remarks) resItem.remarks = remarks;

  // Deduct stock if approved
  if (status === 'Approved') {
    const eq = equipment.find(e => e.id === resItem.equipmentId);
    if (eq && eq.availableQty >= resItem.qty) {
      eq.availableQty -= resItem.qty;
    }
  }

  res.json({ success: true, reservation: resItem });
});

// DELETE: Cancel pending reservation (Student)
app.delete('/api/reservations/:id', (req, res) => {
  const { id } = req.params;
  const index = reservations.findIndex(r => r.id === id);
  
  if (index !== -1) {
    const deleted = reservations.splice(index, 1)[0];
    return res.json({ success: true, message: 'Reservation cancelled', reservation: deleted });
  }
  res.status(404).json({ success: false, message: 'Reservation not found' });
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