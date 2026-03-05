const homeService = require("../services/home_service");

class HomeController {
  /**
   * GET /home – Returns customer home data
   */
  async getHomeData(req, res) {
    try {
      const userId = req.user._id; // set by authMiddleware
      const result = await homeService.getCustomerHomeData(userId);

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

module.exports = new HomeController();