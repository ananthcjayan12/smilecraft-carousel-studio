// The public offer and weekly planner share the same content mix.
export const clinicPlan = Object.freeze({
  id: 'weekly-content', name: 'Weekly content', price: 80, credits: 1000,
  currency: 'USD', description: 'One practice. A consistent week of content.',
  weeklyTypes: ['carousel', 'carousel', 'post', 'post', 'story', 'story'],
  // Includes brief preparation, writing and validation for each piece.
  weeklyBaseCredits: 164
});
