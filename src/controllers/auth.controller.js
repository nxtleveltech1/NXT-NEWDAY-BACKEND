import auth from '../services/auth.service.js';

// @desc    Register user
exports.signup = async (req, res, next) => {
  const { email, password, firstName, lastName } = req.body;

  try {
    const user = await auth.users.create({
      email,
      password,
      firstName,
      lastName,
    });

    const token = await auth.sessions.create({
      userId: user.id,
      ttl: 60 * 60 * 24 * 7, // 1 week
    });

    res.status(201).json({
      success: true,
      token,
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
exports.login = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const { userId } = await auth.sessions.authenticate({
      email,
      password,
    });

    const token = await auth.sessions.create({
      userId,
      ttl: 60 * 60 * 24 * 7, // 1 week
    });

    res.status(200).json({
      success: true,
      token,
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
exports.forgotPassword = async (req, res, next) => {
  const { email } = req.body;

  try {
    await auth.users.sendPasswordResetEmail({ email });

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
exports.resetPassword = async (req, res, next) => {
  const { token, password } = req.body;

  try {
    await auth.users.resetPassword({
      token,
      password,
    });

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