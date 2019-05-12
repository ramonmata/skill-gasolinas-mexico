/* eslint-disable  func-names */
/* eslint-disable  no-console */

const Alexa = require('ask-sdk-core');
const axios = require('axios');

axios.defaults.baseURL = process.env.OCTANOS_ENDPOINT
axios.defaults.headers.common['Authorization'] = process.env.OCTANOS_AUTHORIZATION_KEY
axios.defaults.headers.timeout = 1000

const fetchPrices = async (postalCode) => {
  try {
    const { data } = await axios.get('/postalCode/'+postalCode);
    if (data) {
      return data;
    } else {
      return null;
    }
  } catch (error) {
    console.error(error);
    console.error('cannot fetch quotes for postal code', postalCode);
  }
}

// Capture device Postal Code only once per session
const HasConsentTokenRequestInterceptor = {
  async process(handlerInput) {
    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (handlerInput.requestEnvelope.context.System.user.permissions
        && handlerInput.requestEnvelope.context.System.user.permissions.consentToken
        && requestEnvelope.session.new) {
      const { deviceId } = requestEnvelope.context.System.device;
      const deviceAddressServiceClient = serviceClientFactory.getDeviceAddressServiceClient();
      const shortAddress = await deviceAddressServiceClient.getCountryAndPostalCode(deviceId);
      
      if (shortAddress && shortAddress.postalCode) {
        sessionAttributes.postalCode = shortAddress.postalCode;
      }
      attributesManager.setSessionAttributes(sessionAttributes);
    }
  }
}

// Capture Prices by Postal Code
const PriceFromPostalCodeRequestInterceptor = {
  async process(handlerInput) {
    const { attributesManager } = handlerInput;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.postalCode &&
        !sessionAttributes.localPrices) {
      try {
        let fetchedData = await fetchPrices(sessionAttributes.postalCode);
        if (fetchedData) {
          sessionAttributes.localPrices = fetchedData[0]
        } else {
          sessionAttributes.localPrices = null;
        }
      } catch (err) {
        sessionAttributes.localPrices = null;
        console.log('Error fetching prices from postal code ' + sessionAttributes.postalCode);
        console.log(err);
      }
      attributesManager.setSessionAttributes(sessionAttributes);
    }
  }
}

const permissions = ['read::alexa:device:all:address:country_and_postal_code'];

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest'
      && handlerInput.requestEnvelope.context.System.user.permissions
      && handlerInput.requestEnvelope.context.System.user.permissions.consentToken;
  },
  handle(handlerInput) {
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();
    const localPrices = sessionAttributes.localPrices;
    const repromptSpeechText = 'Prueba a decir: ¿Cuánto cuesta la Magna?, si tienes algna duda sólo di Ayuda';
    
    let speechText;
    if (localPrices && localPrices.municipality_name) {
      speechText = 'Gasolinas de México te ayuda a conocer los últimos precios publicados en '+localPrices.municipality_name+', '+localPrices.state_name+'. Prueba a decir: ¿Cuánto cuesta la Magna?, si tienes alguna duda sólo di: Ayuda';
      return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(repromptSpeechText)
      .withSimpleCard('Gasolinas de México', speechText)
      .getResponse();
    } else {
      speechText = 'Gasolinas de México te ayuda a conocer los últimos precios publicados por las estaciones de servicio en todo México, pero el código postal configurado en tu aplicación de Alexa no parece correcto, verifícalo para así poder ofrecerte información de tu localidad.';
      return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
    }
  },
};

const LaunchRequestHandlerWithoutPermissions = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speechText = '¡Bienvenido! Gasolinas de México, te ayuda a conocer los últimos precios en tu localidad. Habilita los permisos de este Skill con la aplicación de Alexa en tu teléfono celular';
    return handlerInput.responseBuilder
      .speak(speechText)
      .withAskForPermissionsConsentCard(permissions)
      .getResponse();
  },
};

// Get value from slot or a default
function resolveSlot(slots, name, defaultValue) {
  let resolvedValue = defaultValue
  if (slots[name] &&
      slots[name].resolutions &&
      (slots[name].resolutions.resolutionsPerAuthority[0].status.code === 'ER_SUCCESS_MATCH') &&
       slots[name].resolutions.resolutionsPerAuthority[0].values.length > 0) {
        resolvedValue = slots[name].resolutions.resolutionsPerAuthority[0].values[0].value.name
      }
  return resolvedValue
}

function makePriceInPesos(numbers) {
  if (numbers && numbers>0) {
    let splitNumber = numbers.toString().split('.')
    let pesos = splitNumber[0]
    let cents
    if (splitNumber.length > 1) {
      cents = Math.floor(Number('0.' + splitNumber[1]) * 100)
      if (cents<10) {
        cents = '0' + cents
      }
    } else {
      cents = '00'
    }
    return '$' + pesos + '.' + cents;
  } else {
    return 'desconocido'
  }
}

const PricesIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'PricesIntent';
  },
  handle(handlerInput) {
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();
    const localPrices = sessionAttributes.localPrices;
    const gasolinaType = resolveSlot(
      handlerInput.requestEnvelope.request.intent.slots,
      'gasolina',
      'gasolina')
      
    if (!localPrices) {
     return handlerInput.responseBuilder
          .speak('No tenemos información para el código postal ' + sessionAttributes.postalCode)
    }
    
    let speechSaluteText
    let speechSaluteMedianText = ' y con un precio promedio de '
    let repromptSpeechText
    // Flag to detect if this is the first time providing a price
    if (!sessionAttributes.firstTimeDone) {
      sessionAttributes.firstTimeDone = true
      attributesManager.setSessionAttributes(sessionAttributes);
      if (localPrices && localPrices.stations>0 && localPrices.stations == 1) {
        speechSaluteText = 'Existe una estacion de servicio en '+localPrices.municipality_name+', el precio máximo por litro';
        repromptSpeechText = '¿Quieres consultar precios para otro tipo de gasolina?'
      } else if (localPrices &&  localPrices.stations>0 && localPrices.stations > 1) {
        speechSaluteText = 'De las '+localPrices.stations+' estaciones de servicio en '+localPrices.municipality_name+', el precio máximo por litro';
        repromptSpeechText = '¿Quieres consultar precios para otro tipo de gasolina?' 
      } else if (localPrices){
        return handlerInput.responseBuilder
          .speak('No existen registros de estaciones de servicio para ' + localPrices.municipality_name + ' o no las han reportado.')
      } else {
        return handlerInput.responseBuilder
          .speak('No tenemos información para el código postal ' + sessionAttributes.postalCode)
      }
    } else {
      speechSaluteText = 'El precio máximo por litro';
      repromptSpeechText = '¿Quieres consultar otro precio?'
    }
    
    let speechText = ''
    
    const speechAllTypesText = ' para la gasolina Magna es ' 
      + makePriceInPesos(localPrices.regular_max) + ', para la Premium ' 
      + makePriceInPesos(localPrices.premium_max) + ' y para el Diésel ' 
      + makePriceInPesos(localPrices.diesel_max);
    const speechRegularAndPremiumTypesText = ' de gasolina ';
    const speechDieselTypeText = ' para el Diésel es ';
    
    if (gasolinaType==='gasolina') {
      speechText = speechSaluteText + speechAllTypesText
    } else if (gasolinaType==='diesel') {
      if (localPrices.diesel_max) {
      speechText = speechSaluteText + speechDieselTypeText + makePriceInPesos(localPrices.diesel_max) + 
      speechSaluteMedianText + makePriceInPesos(localPrices.diesel_median)
      } else {
        speechText = 'No parecen ofrecer este combustible las ' + localPrices.stations+ ' de servicio en ' + localPrices.municipality_name
      }
    } else {
      speechText = speechSaluteText + speechRegularAndPremiumTypesText 
        + (gasolinaType==='magna' ? 'Magna' : 'Premium') + ' es ' 
        + (gasolinaType==='magna' ? makePriceInPesos(localPrices.regular_max) : makePriceInPesos(localPrices.premium_max))
        + speechSaluteMedianText
        + (gasolinaType==='magna' ? makePriceInPesos(localPrices.regular_median) : makePriceInPesos(localPrices.premium_median))
    }
    
    if (gasolinaType!='gasolina') {
      return handlerInput.responseBuilder
      .speak(speechText + '. ' +repromptSpeechText)
      .reprompt(repromptSpeechText)
      .withSimpleCard('Precios', speechText)
      .getResponse();
    } else {
      return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Precios', speechText)
      .getResponse();
    }
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speechText = 'Para consultar los precios, simplemente di: ¿Cuánto cuesta la gasolina? ó ¿Cuánto cuesta la Magna?!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .withSimpleCard('Ayuda Gasolinas de México', speechText)
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const speechText = '¡Gracias por consultar los precios con Gasolinas de México!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended reason: ${handlerInput.requestEnvelope.request.reason}`);
    console.log(handlerInput.requestEnvelope.request);
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);
    const errorSpeechText = 'Lo siento, no pude comprender el comando. Inténtalo de nuevo';
    return handlerInput.responseBuilder
      .speak(errorSpeechText)
      .reprompt(errorSpeechText)
      .getResponse();
  },
};

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .addRequestInterceptors(
    //PingLambdaRequestInterceptor,
    HasConsentTokenRequestInterceptor,
    PriceFromPostalCodeRequestInterceptor
  )
  .addRequestHandlers(
    LaunchRequestHandler,
    LaunchRequestHandlerWithoutPermissions,
    PricesIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();
