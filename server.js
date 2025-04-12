require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const xlsx = require("xlsx");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const nodemailer = require("nodemailer");
const router = express.Router();

// Initialize Express App
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(cors({
    origin: ["http://127.0.0.1:5500", "http://127.0.0.1:5501"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

// Database Connection
mongoose.connect(process.env.MONGO_URI || "mongodb+srv://dharania81:dharanish2813@dharani.i3kbx.mongodb.net/?retryWrites=true&w=majority&appName=dharani",
    {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
}).then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Connection Failed:", err));

// Schemas and Models
const userSchema = new mongoose.Schema({
    firstname: String,
    lastname: String,
    email: { type: String, unique: true },
    mobile: String,
    registerNumber: { type: String, unique: true },
    department: String,
    course: String,
    password: String,
    role: { type: String, default: "student" }
});
const User = mongoose.model("User", userSchema);

const studentSchema = new mongoose.Schema({
    name: String,
    registerNumber: String,
    department: String,
    year: Number,
    semester: Number,
    tuitionFees: Number,
    hostelFees: Number,
    totalFees: Number
});
const Student = mongoose.model("Student", studentSchema);

const paymentSchema = new mongoose.Schema({
    studentName: String,
    registerNumber: String,
    department: String,
    year: Number,
    semester: Number,
    date: { type: Date, required: true },
    upiId: String,
    amount: Number,
    feeType: { type: String, required: true, enum: ['tuition', 'hostel'] },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'paid', 'failed'], 
        default: "pending" 
    },
    verified: { type: Boolean, default: false },
    processingStartedAt: Date,
    processingExpiresAt: Date
}, { timestamps: true });
const Payment = mongoose.model("Payment", paymentSchema);

const adminSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: "admin" }
});
const Admin = mongoose.model("Admin", adminSchema);

const otpSchema = new mongoose.Schema({
    email: { type: String, required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });
const OTP = mongoose.model('OTP', otpSchema);

// Constants
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const PROCESSING_EXPIRY_MINUTES = 30; // 30 minutes processing window

// Create default admin if not exists
async function createAdmin() {
    const existingAdmin = await Admin.findOne({ email: "admin@example.com" });
    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash("admin123", 12);
        await Admin.create({ 
            email: "admin@example.com", 
            password: hashedPassword,
            role: "admin"
        });
        console.log("✅ Admin Created - Email: admin@example.com, Password: admin123");
    }
}
createAdmin();

// Middleware
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized - No token provided" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if the token has admin role
        if (decoded.role !== "admin") {
            return res.status(403).json({ message: "Forbidden - Admin access required" });
        }

        // Verify admin exists in database
        const admin = await Admin.findById(decoded._id);
        if (!admin) {
            return res.status(403).json({ message: "Forbidden - Admin not found" });
        }

        req.admin = admin;
        next();
    } catch (error) {
        return res.status(401).json({ message: "Unauthorized - Invalid token" });
    }
};

const authenticateUser = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Verify user exists in database
        const user = await User.findById(decoded._id);
        if (!user) {
            return res.status(403).json({ message: "Forbidden - User not found" });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ message: "Invalid token" });
    }
};

// Nodemailer Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-email-password'
    }
});

// Cleanup expired processing payments (run periodically)
async function cleanupExpiredProcessingPayments() {
    try {
        const result = await Payment.updateMany(
            { 
                status: 'processing',
                processingExpiresAt: { $lt: new Date() }
            },
            { $set: { status: 'failed' } }
        );
        console.log(`Cleaned up ${result.nModified} expired processing payments`);
    } catch (error) {
        console.error("Error cleaning up expired payments:", error);
    }
}

// Routes
// Admin Routes
app.post("/admin/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        // Create token with consistent structure
        const token = jwt.sign(
            { 
                _id: admin._id,
                role: admin.role,
                email: admin.email
            }, 
            JWT_SECRET, 
            { expiresIn: "1d" }
        );

        res.json({ 
            message: "Admin login successful",
            token,
            admin: {
                _id: admin._id,
                email: admin.email,
                role: admin.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Login failed", error: error.message });
    }
});

app.get("/admin/dashboard", authenticateAdmin, async (req, res) => {
    try {
        const studentCount = await Student.countDocuments();
        const pendingPayments = await Payment.countDocuments({ status: "pending" });
        const processingPayments = await Payment.countDocuments({ status: "processing" });
        const totalPayments = await Payment.countDocuments();
        
        res.json({
            studentCount,
            pendingPayments,
            processingPayments,
            totalPayments,
            message: "Welcome to the admin dashboard"
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching dashboard data", error });
    }
});

// Student Routes
app.post("/signup", async (req, res) => {
    try {
        const { firstname, lastname, email, mobile, registerNumber, department, course, password } = req.body;
        if (!firstname || !lastname || !email || !password || !registerNumber) {
            return res.status(400).json({ message: "All fields are required!" });
        }
        const existingUser = await User.findOne({ $or: [{ registerNumber }, { email }] });
        if (existingUser) return res.status(400).json({ message: "User already exists!" });
        
        const hashedPassword = await bcrypt.hash(password, 12);
        await new User({ firstname, lastname, email, mobile, registerNumber, department, course, password: hashedPassword }).save();
        res.json({ message: "Signup successful!" });
    } catch (error) {
        res.status(500).json({ message: "Signup failed", error: error.message });
    }
   
});
// Add this with your other routes
app.get("/students", authenticateAdmin, async (req, res) => {
    try {
        const students = await Student.find({});
        res.json(students);
    } catch (error) {
        res.status(500).json({ message: "Error fetching students", error });
    }
});
app.post("/signin", async (req, res) => {
    try {
        const { registerNumber, email, password } = req.body;
        const user = await User.findOne({ registerNumber, email });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { 
                _id: user._id, 
                role: user.role,
                email: user.email,
                registerNumber: user.registerNumber
            }, 
            JWT_SECRET, 
            { expiresIn: "7d" }
        );
        
        res.json({ 
            token, 
            user: {
                _id: user._id,
                firstname: user.firstname,
                lastname: user.lastname,
                email: user.email,
                registerNumber: user.registerNumber,
                department: user.department,
                course: user.course,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Signin failed", error: error.message });
    }
});

// Student Data Routes
app.get("/student-fees/:registerNumber", async (req, res) => {
    try {
        const student = await Student.findOne({ registerNumber: req.params.registerNumber });
        if (!student) return res.status(404).json({ message: "No fee details found!" });

        // Check for any processing payments
        const processingPayments = await Payment.find({
            registerNumber: req.params.registerNumber,
            status: 'processing',
            processingExpiresAt: { $gt: new Date() }
        });

        const response = {
            tuitionFees: student.tuitionFees,
            hostelFees: student.hostelFees,
            processing: {
                tuition: processingPayments.some(p => p.feeType === 'tuition'),
                hostel: processingPayments.some(p => p.feeType === 'hostel')
            }
        };

        res.json(response);
    } catch (error) {
        res.status(500).json({ message: "Error fetching fee details", error: error.message });
    }
});

// Example Express route
app.get('/payment-history/:registerNumber', async (req, res) => {
    try {
      const payments = await Payment.find({
        registerNumber: req.params.registerNumber
      }).sort({ date: -1 });
      
      if (!payments.length) {
        return res.status(200).json({
          payments: [],
          message: "No payments found for this account"
        });
      }
      
      res.json({ payments });
    } catch (error) {
      res.status(500).json({
        error: "Server error",
        details: error.message
      });
    }
  });

// Payment Processing Routes
app.post("/process-payment", authenticateUser, async (req, res) => {
    try {
        const { upiId, amount, feeType, paymentDate } = req.body;
        const user = req.user;

        if (!upiId || !amount || !feeType || !paymentDate) {
            return res.status(400).json({ message: "All payment details are required." });
        }

        const student = await Student.findOne({ registerNumber: user.registerNumber });
        if (!student) return res.status(404).json({ message: "Student record not found." });

        // Check if there's already a processing payment for this fee type
        const existingProcessing = await Payment.findOne({
            registerNumber: user.registerNumber,
            feeType,
            status: 'processing',
            processingExpiresAt: { $gt: new Date() }
        });

        if (existingProcessing) {
            return res.status(400).json({ 
                message: "Payment already processing",
                paymentId: existingProcessing._id
            });
        }

        // Create new processing payment
        const newPayment = await Payment.create({
            studentName: `${user.firstname} ${user.lastname}`,
            registerNumber: user.registerNumber,
            department: student.department,
            year: student.year,
            semester: student.semester,
            date: paymentDate,
            upiId,
            amount,
            feeType,
            status: "processing",
            processingStartedAt: new Date(),
            processingExpiresAt: new Date(Date.now() + PROCESSING_EXPIRY_MINUTES * 60 * 1000)
        });

        res.json({ 
            message: "Payment processing started",
            paymentId: newPayment._id
        });

    } catch (error) {
        res.status(500).json({ message: "Payment processing failed", error: error.message });
    }
});
// Add these with your other routes
// Example backend route (Node.js/Express)
app.post('/api/payments', async (req, res) => {
    try {
        const { amount, feeType, transactionId, upiId } = req.body;

        // Store with a permanent timestamp
        const payment = await Payment.create({
            registerNumber: req.user.registerNumber,
            amount,
            feeType,
            transactionId,
            upiId,
            status: "pending", // or "success" if confirmed
            date: new Date() // Permanent timestamp
        });

        res.status(201).json(payment);
    } catch (error) {
        res.status(500).json({ error: "Failed to save payment record." });
    }
});
// Get all payments (pending and processing)
app.get("/admin/payments", authenticateAdmin, async (req, res) => {
    try {
        const payments = await Payment.find({
            status: { $in: ['pending', 'processing', 'paid', 'failed'] }
        }).sort({ createdAt: -1 });
        res.json(payments);
    } catch (error) {
        res.status(500).json({ message: "Error fetching payments", error });
    }
});

// Verify payment
app.post("/admin/verify-payment/:paymentId", authenticateAdmin, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.paymentId);
        if (!payment) return res.status(404).json({ message: "Payment not found" });

        if (payment.status === "paid") {
            return res.status(400).json({ message: "Payment already verified" });
        }

        // Update payment status
        payment.status = "paid";
        payment.verified = true;
        payment.verifiedBy = req.admin._id;
        payment.verifiedAt = new Date();
        await payment.save();

        // Update student fees
        const student = await Student.findOne({ registerNumber: payment.registerNumber });
        if (student) {
            if (payment.feeType === "tuition") {
                student.tuitionFees = Math.max(0, student.tuitionFees - payment.amount);
            } else if (payment.feeType === "hostel") {
                student.hostelFees = Math.max(0, student.hostelFees - payment.amount);
            }
            student.totalFees = student.tuitionFees + student.hostelFees;
            await student.save();
        }

        res.json({ message: "Payment verified successfully", payment });
    } catch (error) {
        res.status(500).json({ message: "Error verifying payment", error });
    }
});

// Mark payment as invalid
app.post("/admin/invalid-payment/:paymentId", authenticateAdmin, async (req, res) => {
    try {
        const payment = await Payment.findByIdAndUpdate(
            req.params.paymentId,
            { 
                status: 'failed',
                verified: false,
                verifiedBy: req.admin._id,
                verifiedAt: new Date(),
                processingExpiresAt: null
            },
            { new: true }
        );
        
        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        res.json({ 
            message: 'Payment marked as invalid',
            payment
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Error marking payment as invalid',
            error 
        });
    }
});
// Permanent delete (Admin only) - No history kept
app.delete("/admin/delete-payment/:paymentId", authenticateAdmin, async (req, res) => {
    try {
        // 1. Validate paymentId
        if (!mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
            return res.status(400).json({ message: 'Invalid payment ID' });
        }

        // 2. Check if payment exists
        const payment = await Payment.findById(req.params.paymentId);
        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        // 3. Permanent delete
        await Payment.deleteOne({ _id: req.params.paymentId }); // Hard delete

            res.json({ 
                success: true,
                message: 'Payment permanently deleted (admin only)',
                deletedPaymentId: req.params.paymentId
            });

    } catch (error) {
        console.error("[Admin] Delete error:", error);
        res.status(500).json({ 
            success: false,
            message: 'Admin deletion failed',
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
});

// Admin Payment Management
app.get("/admin/pending-payments", authenticateAdmin, async (req, res) => {
    try {
        const payments = await Payment.find({ status: "pending" });
        res.json(payments);
    } catch (error) {
        res.status(500).json({ message: "Error fetching payments", error });
    }
});

app.get("/admin/processing-payments", authenticateAdmin, async (req, res) => {
    try {
        const payments = await Payment.find({ 
            status: "processing",
            processingExpiresAt: { $gt: new Date() }
        });
        res.json(payments);
    } catch (error) {
        res.status(500).json({ message: "Error fetching processing payments", error });
    }
});

// Excel Upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/upload-excel", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded!" });
    }
    
    try {
        const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const formattedData = jsonData.map(student => ({
            name: student["Name"],
            registerNumber: student["Register Number"],
            department: student["Department"],
            semester: Number(student["Semester"]),
            year: Number(student["Year"]),
            tuitionFees: Number(student["Tuition Fees"]),
            hostelFees: Number(student["Hostel Fees"]),
            totalFees: Number(student["Total Fees"])
        }));

        await Promise.all(formattedData.map(async (student) => {
            await Student.updateOne(
                { registerNumber: student.registerNumber },
                { $set: student },
                { upsert: true }
            );
        }));
        
        res.json({ message: "Excel file uploaded & data stored successfully!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error processing file", error });
    }
});

// Delete all students endpoint
app.delete('/students', async (req, res) => {
    try {
        const result = await Student.deleteMany({});
        res.status(200).json({
            message: `Successfully deleted ${result.deletedCount} student records`
        });
    } catch (error) {
        res.status(500).json({
            message: 'Failed to reset student data',
            error: error.message
        });
    }
});

// Password Reset
app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        await OTP.create({ email, otp, expiresAt });

        const mailOptions = {
            from: process.env.EMAIL_USER || 'your-email@gmail.com',
            to: email,
            subject: 'Password Reset OTP',
            text: `Your OTP for password reset is: ${otp}. This OTP is valid for 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: "OTP sent to your email" });
    } catch (error) {
        res.status(500).json({ message: "Error processing request", error: error.message });
    }
});

app.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const otpRecord = await OTP.findOne({ email, otp });
        
        if (!otpRecord) return res.status(400).json({ message: "Invalid OTP" });
        if (new Date() > otpRecord.expiresAt) {
            await OTP.deleteOne({ _id: otpRecord._id });
            return res.status(400).json({ message: "OTP has expired" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await User.updateOne({ email }, { password: hashedPassword });
        await OTP.deleteOne({ _id: otpRecord._id });

        res.json({ message: "Password updated successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error resetting password", error: error.message });
    }
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);

    // Initial cleanup on startup
    cleanupExpiredProcessingPayments();
});