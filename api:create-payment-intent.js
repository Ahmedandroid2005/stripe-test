// Vercel Serverless Function
// المسار النهائي بعد الرفع: https://YOUR-PROJECT.vercel.app/api/create-payment-intent

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secretKey, amount, currency } = req.body || {};

  if (!secretKey || !secretKey.startsWith('sk_')) {
    return res.status(400).json({ error: 'المفتاح السري غير صالح. يجب أن يبدأ بـ sk_test_' });
  }

  try {
    const stripe = require('stripe')(secretKey);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount || 500, // بالوحدة الصغرى (سنت) - 500 = 5.00
      currency: currency || 'myr',
      automatic_payment_methods: { enabled: true },
    });
    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
