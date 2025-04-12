const apiBase = "http://localhost:3001";

// Uppercase conversion for specific fields
const uppercaseFields = document.querySelectorAll('.uppercase-field');
uppercaseFields.forEach(field => {
    field.addEventListener('input', function() {
        this.value = this.value.toUpperCase();
    });
    field.addEventListener('blur', function() {
        this.value = this.value.toUpperCase();
    });
});

// Signup Form Handling
document.getElementById("signupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    // Get form elements
    const signupBtn = document.getElementById("signupBtn");
    const btnText = document.getElementById("btnText");
    const spinner = document.getElementById("spinner");
    const messageEl = document.getElementById("message");
    
    // Show loading state
    signupBtn.disabled = true;
    btnText.textContent = "Creating Account...";
    spinner.style.display = "inline-block";
    messageEl.textContent = "";
    messageEl.className = "text-center mt-3";
    
    // Prepare user data
    const userData = {
        firstname: document.getElementById("firstName").value.trim(),
        lastname: document.getElementById("lastName").value.trim(),
        email: document.getElementById("email").value.trim(),
        mobile: document.getElementById("mobile").value.trim(),
        registerNumber: document.getElementById("registerNumber").value.trim(),
        department: document.getElementById("department").value.trim(),
        course: document.getElementById("course").value.trim(),
        password: document.getElementById("password").value.trim(),
    };

    // Password confirmation check
    const confirmPassword = document.getElementById("confirmPassword").value.trim();
    if (userData.password !== confirmPassword) {
        showError(messageEl, "Passwords do not match");
        resetButtonState();
        return;
    }

    try {
        const response = await fetch(`${apiBase}/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Signup failed");
        }

        // Success case
        showSuccess(messageEl, "Account created successfully! Redirecting...");
        setTimeout(() => {
            window.location.href = "signin.html";
        }, 1500);
        
    } catch (error) {
        console.error("Signup Error:", error);
        showError(messageEl, error.message || "An error occurred during signup");
    } finally {
        resetButtonState();
    }

    function resetButtonState() {
        signupBtn.disabled = false;
        btnText.textContent = "Create Account";
        spinner.style.display = "none";
    }

    function showError(element, message) {
        element.textContent = message;
        element.classList.add("text-danger");
    }

    function showSuccess(element, message) {
        element.textContent = message;
        element.classList.add("text-success");
    }
});

// Signin Form Handling
document.getElementById("signinForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const signinBtn = document.getElementById("signinBtn");
    const btnText = document.getElementById("btnText");
    const spinner = document.getElementById("spinner");
    const messageEl = document.getElementById("message");
    
    // Show loading state
    signinBtn.disabled = true;
    btnText.textContent = "Signing In...";
    spinner.style.display = "inline-block";
    messageEl.textContent = "";
    messageEl.className = "text-center mt-3";

    const userData = {
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value.trim(),
    };

    try {
        const response = await fetch(`${apiBase}/signin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Signin failed");
        }

        // Store token and user data
        localStorage.setItem("token", data.token);
        localStorage.setItem("userEmail", userData.email);
        
        if (data.userData) {
            localStorage.setItem("userData", JSON.stringify(data.userData));
        }

        showSuccess(messageEl, "Signin successful! Redirecting...");
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 1000);
        
    } catch (error) {
        console.error("Signin Error:", error);
        showError(messageEl, error.message || "Invalid credentials");
    } finally {
        signinBtn.disabled = false;
        btnText.textContent = "Sign In";
        spinner.style.display = "none";
    }
});

// Dashboard Authentication Check
if (window.location.pathname.includes("dashboard.html")) {
    document.addEventListener("DOMContentLoaded", () => {
        const token = localStorage.getItem("token");
        const userEmail = localStorage.getItem("userEmail");
        
        if (!token || !userEmail) {
            alert("Please sign in to access the dashboard");
            window.location.href = "signin.html";
            return;
        }

        // Fetch user data
        fetch(`${apiBase}/user/${userEmail}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(async res => {
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || "Failed to fetch user data");
            }
            return res.json();
        })
        .then(user => {
            document.getElementById("userName").textContent = user.firstname;
            document.getElementById("loggedUserName").textContent = user.firstname;
        })
        .catch(err => {
            console.error("Error fetching user data:", err);
            alert("Session expired. Please sign in again");
            localStorage.clear();
            window.location.href = "signin.html";
        });
    });
}