const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      history: [],
      slots: {
        guestName: null,
        originCity: null,
        originAirportCode: null,
        destinationCity: null,
        destinationCityCode: null,
        destinationAirportCode: null,
        departDate: null,
        returnDate: null,
        adults: null,
        children: null,
        budgetINR: null,
        tripVibe: null,
      },
      result: null, // populated once the pipeline has run
    });
  }
  return sessions.get(sessionId);
}

module.exports = { getSession };
