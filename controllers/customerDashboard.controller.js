const customerDashboardService = require("../services/customerDashboard.service");

class CustomerDashboardController {
  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/customer/dashboard/:userId   (staff – any customer)
  // GET /api/v1/customer/dashboard/me        (customer – own dashboard)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Staff route – view any customer's full dashboard.
   * Resolves userId from the URL parameter.
   */
  async getDashboard(req, res) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: "userId path parameter is required",
        });
      }

      const result =
        await customerDashboardService.getCustomerDashboard(userId);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error(
        "[CustomerDashboardController.getDashboard]",
        error.message,
      );
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Self-service route – a logged-in customer views their own dashboard.
   * Resolves userId from the JWT payload set by authMiddleware (req.user._id).
   */
  async getMyDashboard(req, res) {
    try {
      const userId = req.user?._id?.toString();

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authenticated user not found in request context",
        });
      }

      const result =
        await customerDashboardService.getCustomerDashboard(userId);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error(
        "[CustomerDashboardController.getMyDashboard]",
        error.message,
      );
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new CustomerDashboardController();
