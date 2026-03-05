const customerDashboardService = require("../services/customerDashboard.service");

class CustomerDashboardController {
  /**
   * GET /customer/dashboard/:userId – Returns full dashboard for the specified customer
   */
  async getDashboard(req, res) {
    try {
      const { userId } = req.params; // Extract userId from URL parameter
      const result =
        await customerDashboardService.getCustomerDashboard(userId);
      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new CustomerDashboardController();
