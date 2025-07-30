import auth from '../services/auth.service.js';

// @desc    Register user
export const signup = async (req, res, next) => {
  const { email, password, firstName, lastName } = req.body;

  try {
    // For now, just generate a token without user creation
    // In a real app, you'd save the user to database first
    const hashedPassword = await auth.hashPassword(password);
    const userId = Date.now().toString(); // Temporary user ID
    
    const token = auth.generateToken(userId);

    res.status(201).json({
      success: true,
      token,
      user: { id: userId, email, firstName, lastName }
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Authenticate user & get token
export const login = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    // For now, just generate a token
    // In a real app, you'd verify credentials against database
    const userId = Date.now().toString(); // Temporary user ID
    const token = auth.generateToken(userId);

    res.status(200).json({
      success: true,
      token,
      user: { id: userId, email }
    });
  } catch (error) {
    console.error(error);
    res.status(401).json({
      success: false,
      error: 'Invalid credentials',
    });
  }
};

// @desc    Forgot password
export const forgotPassword = async (req, res, next) => {
  const { email } = req.body;

  try {
    // Placeholder for password reset functionality
    res.status(200).json({
      success: true,
      message: 'Password reset email sent',
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Reset password
export const resetPassword = async (req, res, next) => {
  const { token, password } = req.body;

  try {
    // Placeholder for password reset functionality
    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};