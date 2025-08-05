// A mock function to simulate fetching customers from a database
const getCustomers = async (req, res) => {
  try {
    // In a real application, you would fetch this data from your database
    const mockCustomers = [
      {
        id: "1",
        name: "John Doe",
        email: "john.doe@example.com",
        phone: "+27-12-345-6789",
        address: "123 Main St, Anytown",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "2",
        name: "Jane Smith",
        email: "jane.smith@example.com",
        phone: "+27-98-765-4321",
        address: "456 Oak Ave, Othertown",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    res.status(200).json({
      success: true,
      data: mockCustomers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server Error",
      code: 500,
      timestamp: new Date().toISOString(),
    });
  }
};

export { getCustomers };