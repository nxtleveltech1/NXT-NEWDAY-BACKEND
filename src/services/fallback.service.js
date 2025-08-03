export async function getMetricsWithFallback() {
  try {
    // Simulate fallback mechanism
    return {
      success: true,
      data: {
        fallback: true,
        metrics: [],
        timestamp: new Date()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

export async function getEventsWithFallback() {
  try {
    // Simulate fallback mechanism
    return {
      success: true,
      data: {
        fallback: true,
        events: [],
        timestamp: new Date()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}