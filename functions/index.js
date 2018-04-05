// Copyright 2017, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

/**
 * Trivia game fulfillment logic
 */

process.env.DEBUG = 'actions-on-google:*';
const { DialogflowApp } = require('actions-on-google');
const functions = require('firebase-functions');
const firebaseAdmin = require('firebase-admin');

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
firebaseAdmin.initializeApp();

/**
 * (Optional) Change this to the url of your custom hosting site
 * By default, it uses the Firebase hosting authDomain as the root url
 */
const CUSTOM_HOSTING_URL = '';

const HOSTING_URL = CUSTOM_HOSTING_URL || `https://${firebaseConfig.projectId}.firebaseapp.com`;

// Logging dependencies
const winston = require('winston');
winston.loggers.add('DEFAULT_LOGGER', {
  console: {
    colorize: true,
    label: 'Default logger',
    json: false,
    timestamp: true
  }
});
const logger = winston.loggers.get('DEFAULT_LOGGER');
const { logObject } = require('./utils');
logger.transports.console.level = 'debug';

const Ssml = require('./ssml').SSML;
const { sprintf } = require('sprintf-js');
const utils = require('./utils');

const { Themes, PROMPT_TYPES, AUDIO_TYPES, THEME_TYPES } = require('./themes');

const { generateSynonyms, getSynonyms } = require('./utils');

const MAIN_INTENT = 'game.start';
const VALUE_INTENT = 'game.choice.value';
const UNKNOWN_INTENT = 'game.unknown';
const REPEAT_INTENT = 'game.question.repeat';
const SCORE_INTENT = 'game.score';
const HELP_INTENT = 'game.help';
const QUIT_INTENT = 'game.quit';
const NEW_INTENT = 'game.restart';
const ANSWERS_INTENT = 'game.answers';
const DONT_KNOW_INTENT = 'game.answers.dont_know';
const ORDINAL_INTENT = 'game.choice.ordinal';
const LAST_INTENT = 'game.choice.last';
const MIDDLE_INTENT = 'game.choice.middle';
const TRUE_INTENT = 'game.choice.true';
const FALSE_INTENT = 'game.choice.false';
const HINT_INTENT = 'game.hint';
const PLAY_AGAIN_CONTEXT = 'restart';
const PLAY_AGAIN_YES_INTENT = 'game.restart.yes';
const PLAY_AGAIN_NO_INTENT = 'game.restart.no';
const DONE_CONTEXT = 'quit';
const DONE_YES_INTENT = 'game.quit.yes';
const DONE_NO_INTENT = 'game.quit.no';
const HELP_CONTEXT = 'help';
const HELP_YES_INTENT = 'game.help.yes';
const HELP_NO_INTENT = 'game.help.no';
const UNKNOWN_DEEPLINK_ACTION = 'deeplink.unknown';
const RAW_TEXT_ARGUMENT = 'raw_text';
const DISAGREE_INTENT = 'game.answers.wrong';
const ANSWER_INTENT = 'game.choice.answer';
const ANSWER_ARGUMENT = 'answer';
const MISTAKEN_INTENT = 'game.mistaken';
const FEELING_LUCKY_INTENT = 'game.feeling_lucky';
const TRUE_FALSE_CONTEXT = 'true_false';
const ITEM_INTENT = 'game.choice.item';

const TTS_DELAY = '500ms';

const MAX_PREVIOUS_QUESTIONS = 100;
const SUGGESTION_CHIPS_MAX_TEXT_LENGTH = 25;
const SUGGESTION_CHIPS_MAX = 8;
const GAME_TITLE = 'The Fun Trivia Game';
const QUESTIONS_PER_GAME = 4;

// Firebase data keys
const DATABASE_PATH_USERS = 'users/';
const DATABASE_PATH_DICTIONARY = 'dictionary/';
const DATABASE_QUESTIONS = 'questions';
const DATABASE_DATA = 'data';
const DATABASE_PREVIOUS_QUESTIONS = 'previousQuestions';
const DATABASE_HIGHEST_SCORE = 'highestScore';
const DATABASE_LOWEST_SCORE = 'lowestScore';
const DATABASE_AVERAGE_SCORE = 'averageScore';
const DATABASE_TOTAL_SCORE = 'totalScore';
const DATABASE_SCORES = 'scores';
const DATABASE_VISITS = 'visits';
const DATABASE_ANSWERS = 'answers';
const DATABASE_FOLLOW_UPS = 'followUps';

const theme = THEME_TYPES.TRIVIA_TEACHER_THEME;
const AUDIO_BASE_URL = `${HOSTING_URL}/audio/`;

// Cloud Functions for Firebase entry point
exports.triviaGame = functions.https.onRequest((request, response) => {
  logger.info(logObject('trivia', 'handleRequest', {
    info: 'Handle request',
    headers: JSON.stringify(request.headers),
    body: JSON.stringify(request.body)
  }));

  const app = new DialogflowApp({request, response});
  const themes = new Themes();

  const userId = app.getUser().userId;
  const userIdKey = utils.encodeAsFirebaseKey(userId);
  let questions = [];
  let answers = [];
  let followUps = [];
  let gameLength = QUESTIONS_PER_GAME;
  let last = false;
  let middle = false;
  let ssmlNoInputPrompts;
  let questionPrompt;
  let selectedAnswers;
  let hasLastPrompt = false;

  const hasScreen = app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT);
  logger.info(logObject('trivia', 'handleRequest', {
    info: 'Check screen capability',
    hasScreen: hasScreen
  }));

  // Get the no-input prompts from the VUI prompts
  const selectInputPrompts = () => {
    if (!ssmlNoInputPrompts) {
      // Convert no-input prompts to SSML
      ssmlNoInputPrompts = [];
      const noInputPrompts = [getRandomPrompt(PROMPT_TYPES.NO_INPUT_PROMPTS_1),
        getRandomPrompt(PROMPT_TYPES.NO_INPUT_PROMPTS_2),
        getRandomPrompt(PROMPT_TYPES.NO_INPUT_PROMPTS_3)];
      for (let i = 0; i < noInputPrompts.length; i++) {
        // Markup each no-input prompt as SSML
        const ssmlResponse = new Ssml();
        ssmlResponse.say(noInputPrompts[i]);
        ssmlNoInputPrompts.push(ssmlResponse.toString());
      }
    }
    return ssmlNoInputPrompts;
  };

  // Select a random audio track
  const getRandomAudio = (index) => {
    logger.debug(logObject('trivia', 'getRandomAudio', {
      info: 'Get random audio',
      index: index
    }));
    return AUDIO_BASE_URL + themes.getRandomAudio(theme, index);
  };

  // Select a random prompt
  const getRandomPrompt = (index) => {
    const prompt = themes.getRandomPrompt(theme, index, app.data.lastPrompt);
    if (!hasLastPrompt) {
      hasLastPrompt = true;
      app.data.lastPrompt = prompt;
    }
    return prompt;
  };

  // Select new questions, avoiding the previous questions
  const selectQuestions = (questions) => {
    logger.debug(logObject('trivia', 'post', {
      info: 'selectQuestions'
    }));
    if (!questions) {
      logger.error(logObject('trivia', 'post', {
        info: 'selectQuestions: No questions.'
      }));
      return null;
    }
    if (gameLength > questions.length) {
      logger.error(logObject('trivia', 'post', {
        info: 'selectQuestions: Not enough questions.',
        gameLength: gameLength,
        questions: questions.length
      }));
      gameLength = questions.length;
    }
    let previousQuestions = app.data.previousQuestions;
    logger.debug(logObject('trivia', 'post', {
      previousQuestions: JSON.stringify(previousQuestions),
      questions: questions.length,
      gameLength: gameLength
    }));

    const selected = [];
    if (previousQuestions.length > MAX_PREVIOUS_QUESTIONS ||
        previousQuestions.length >= questions.length) {
      previousQuestions = previousQuestions.slice(gameLength, previousQuestions.length);
    }
    let i = 0;
    const checked = [];
    let index = 0;
    let previousIndex = 0;
    let found;
    // Select new questions, avoiding previous questions
    while (i < gameLength) {
      found = false;
      while (checked.length !== questions.length) {
        index = utils.getRandomNumber(0, questions.length - 1);
        if (selected.indexOf(index) === -1 && previousQuestions.indexOf(index) === -1) {
          selected.push(index);
          i++;
          found = true;
          break;
        }
        if (checked.indexOf(index) === -1) {
          checked.push(index);
        }
      }
      if (!found) {
        selected.push(previousQuestions[previousIndex++]);
        i++;
      }
    }

    logger.debug(logObject('trivia', 'post', {
      selected: JSON.stringify(selected)
    }));
    previousQuestions = previousQuestions.concat(selected);
    app.data.previousQuestions = previousQuestions;
    firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey).update({
      [DATABASE_PREVIOUS_QUESTIONS]: previousQuestions
    });
    return selected;
  };

  // Select answers, using the index selected for the correct answer
  const selectAnswers = (correctIndex, answers) => {
    if (!answers) {
      logger.error(logObject('trivia', 'post', {
        info: 'selectAnswers: No answers.'
      }));
      return null;
    }
    const selected = [];
    if (answers.length > 1) {
      const clonedAnswers = answers.slice(1);
      for (let i = 0; i < answers.length; i++) {
        if (i === correctIndex) {
          selected.push(answers[0]);
        } else {
          const index = utils.getRandomNumber(0, clonedAnswers.length - 1);
          selected.push(clonedAnswers[index]);
          clonedAnswers.splice(index, 1);
        }
      }
    } else {
      logger.error(logObject('trivia', 'post', {
        info: 'selectAnswers: Not enough answers.',
        answers: answers.length
      }));
      return null;
    }
    logger.debug(logObject('trivia', 'selectAnswers', {
      info: 'Selected answers',
      selected: selected
    }));
    return selected;
  };

  // Start a new round of the game by selecting new questions
  const startNewRound = (callback) => {
    firebaseAdmin.database().ref(DATABASE_DATA)
      .once('value', (data) => {
        if (data && data.val() && data.val()[DATABASE_QUESTIONS]) {
          questions = data.val()[DATABASE_QUESTIONS];
          answers = data.val()[DATABASE_ANSWERS];
          followUps = data.val()[DATABASE_FOLLOW_UPS];
          const selectedQuestions = selectQuestions(questions);
          // Construct the initial response
          if (selectedQuestions) {
            const currentQuestion = 0;
            questionPrompt = questions[selectedQuestions[currentQuestion]];
            app.data.fallbackCount = 0;
            let correctIndex = 0;
            selectedAnswers = [];
            const selectedQuestionAnswers = answers[selectedQuestions[currentQuestion]];
            if (isTrueFalseQuestion(selectedQuestionAnswers)) {
              selectedAnswers = selectedQuestionAnswers.slice(0);
            } else {
              correctIndex = utils.getRandomNumber(0, selectedQuestionAnswers.length - 1);
              selectedAnswers = selectAnswers(correctIndex, selectedQuestionAnswers);
            }
            if (selectedAnswers) {
              const sessionQuestions = [];
              for (let i = 0; i < selectedQuestions.length; i++) {
                sessionQuestions.push(questions[selectedQuestions[i]]);
              }
              const sessionAnswers = [];
              for (let i = 0; i < selectedQuestions.length; i++) {
                sessionAnswers.push(answers[selectedQuestions[i]]);
              }
              const sessionFollowUps = [];
              for (let i = 0; i < selectedQuestions.length; i++) {
                if (followUps && followUps.length > 0) {
                  sessionFollowUps.push(followUps[selectedQuestions[i]]);
                } else {
                  sessionFollowUps.push('');
                }
              }

              // Session data for the game logic
              app.data.sessionQuestions = sessionQuestions;
              app.data.selectedAnswers = selectedAnswers;
              app.data.correctAnswer = correctIndex;
              app.data.sessionAnswers = sessionAnswers;
              app.data.sessionFollowUps = sessionFollowUps;
              app.data.questionPrompt = questionPrompt;
              app.data.score = 0;
              app.data.currentQuestion = currentQuestion;
              app.data.gameLength = gameLength;
              app.data.fallbackCount = 0;
              callback(null);
            } else {
              callback(new Error('There is a problem with the answers.'));
            }
          } else {
            callback(new Error('Not enough questions.'));
          }
        } else {
          callback(new Error('No questions.'));
        }
      });
  };

  // Check if question is TRUE/FALSE
  const isTrueFalseQuestion = (answers) => {
    if (answers && answers.length === 2) {
      const synonyms1 = getSynonyms(answers[0]);
      const synonyms2 = getSynonyms(answers[1]);
      if (synonyms1 && synonyms1[0] && synonyms2 && synonyms2[0]) {
        return utils.isTrueFalse([synonyms1[0].toLowerCase(), synonyms2[0].toLowerCase()]);
      }
    }
    return false;
  };

  // Persist the user game score
  const persistScore = () => {
    logger.info(logObject('trivia', 'persistScore', {
      info: 'Persist the user score',
      score: app.data.score,
      userId: userId
    }));
    firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey)
      .once('value', (data) => {
        const score = app.data.score;
        if (data && data.val() && data.val()[DATABASE_HIGHEST_SCORE]) {
          let highestScore = data.val()[DATABASE_HIGHEST_SCORE];
          let lowestScore = data.val()[DATABASE_LOWEST_SCORE];
          let averageScore = data.val()[DATABASE_AVERAGE_SCORE];
          let totalScore = data.val()[DATABASE_TOTAL_SCORE];
          let scores = data.val()[DATABASE_SCORES];

          if (score > highestScore) {
            highestScore = score;
          }
          if (score < lowestScore) {
            lowestScore = score;
          }
          scores++;
          totalScore = totalScore + score;
          averageScore = totalScore / scores;

          firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey).update({
            [DATABASE_HIGHEST_SCORE]: highestScore,
            [DATABASE_LOWEST_SCORE]: lowestScore,
            [DATABASE_AVERAGE_SCORE]: averageScore,
            [DATABASE_TOTAL_SCORE]: totalScore,
            [DATABASE_SCORES]: scores
          });
        } else {
          firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey).update({
            [DATABASE_HIGHEST_SCORE]: score,
            [DATABASE_LOWEST_SCORE]: score,
            [DATABASE_AVERAGE_SCORE]: score,
            [DATABASE_TOTAL_SCORE]: score,
            [DATABASE_SCORES]: 1
          });
        }
      });
  };

  // Main welcome intent handler
  const mainIntent = (app, alternateWelcomePrompt) => {
    logger.info(logObject('trivia', 'mainIntent', {
      info: 'Handling main intent'
    }));

    // Check if the user is new
    firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey)
      .once('value', (data) => {
        let newUser = true;
        let previousQuestions = [];
        if (data && data.val() && data.val()[DATABASE_VISITS]) {
          // Previously visited
          newUser = false;
          const visits = data.val()[DATABASE_VISITS] + 1;
          firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey).update({
            [DATABASE_VISITS]: visits
          });
          if (data.val()[DATABASE_PREVIOUS_QUESTIONS]) {
            previousQuestions = data.val()[DATABASE_PREVIOUS_QUESTIONS];
            logger.debug(logObject('trivia', 'mainIntent', {
              info: 'Has previous questions',
              previousQuestions: JSON.stringify(previousQuestions)
            }));
          }
        } else {
          // First time user
          firebaseAdmin.database().ref(DATABASE_PATH_USERS).child(userIdKey).update({
            [DATABASE_VISITS]: 1
          });
        }
        app.data.previousQuestions = previousQuestions;

        startNewRound((error) => {
          if (error) {
            app.tell(error.message);
          } else {
            const ssmlResponse = new Ssml();
            ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_GAME_INTRO), 'game intro');
            if (alternateWelcomePrompt) {
              ssmlResponse.say(alternateWelcomePrompt);
            } else if (newUser) {
              ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.GREETING_PROMPTS_1), GAME_TITLE));
            } else {
              ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.GREETING_PROMPTS_2), GAME_TITLE));
            }
            ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.INTRODUCTION_PROMPTS));
            ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.FIRST_ROUND_PROMPTS));
            ssmlResponse.pause(TTS_DELAY);
            askQuestion(ssmlResponse, questionPrompt, selectedAnswers);
          }
        });
      });
  };

  // Utility to create the prompt to ask a question
  const askQuestion = (ssmlResponse, question, answers) => {
    logger.debug(logObject('trivia', 'askQuestion', {
      info: 'askQuestion'
    }));
    if (!question || !answers) {
      logger.error(logObject('trivia', 'askQuestion', {
        info: 'askQuestion: No questions',
        question: question,
        answers: answers
      }));
      ssmlResponse.say('No more questions.');
      return;
    }

    const askQuestionAudioOnly = () => {
      logger.debug(logObject('trivia', 'askQuestion', {
        info: 'askQuestionAudioOnly'
      }));
      // Check if true/false question
      if (isTrueFalseQuestion(answers) && question) {
        app.setContext(TRUE_FALSE_CONTEXT);
        ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.TRUE_FALSE_PROMPTS), question));
        ssmlResponse.pause(TTS_DELAY);
        ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_DING), 'ding');
        app.ask(ssmlResponse.toString(), selectInputPrompts());
        return;
      }
      if (question) {
        ssmlResponse.say(question);
      }
      // Format the answers
      for (let i = 0; i < answers.length; i++) {
        const synonyms = getSynonyms(answers[i]);
        if (synonyms && synonyms.length > 0) {
          const synonym = synonyms[0].trim();
          ssmlResponse.pause(TTS_DELAY);
          if (i === answers.length - 2) {
            ssmlResponse.say(`${synonym}, `);
          } else if (i === answers.length - 1) {
            ssmlResponse.say(` or ${synonym}.`);
          } else {
            ssmlResponse.say(`${synonym}, `);
          }
        }
      }
      ssmlResponse.pause(TTS_DELAY);
      ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_DING), 'ding');
      app.ask(ssmlResponse.toString(), selectInputPrompts());
    };
    if (hasScreen) {
      logger.debug(logObject('trivia', 'askQuestion', {
        info: 'hasScreen'
      }));
      // Use two chat bubbles for intro and question
      // Use suggestion chips for answers
      const questionSsmlResponse = new Ssml();
      if (isTrueFalseQuestion(answers) && question) {
        app.setContext(TRUE_FALSE_CONTEXT);
        questionSsmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.TRUE_FALSE_PROMPTS), question));
        questionSsmlResponse.pause(TTS_DELAY);
        questionSsmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_DING), 'ding');
        app.ask(app
          .buildRichResponse()
          .addSimpleResponse(ssmlResponse.toString())
          .addSimpleResponse(questionSsmlResponse.toString())
          .addSuggestions([utils.TRUE, utils.FALSE]));
        return;
      }
      const chips = [];
      // Use a list to show the answers if they don't meet the
      // suggestion chips requirements:
      // https://developers.google.com/actions/app/responses#suggestion-chip
      let useList = answers.length > SUGGESTION_CHIPS_MAX;
      for (let i = 0; i < answers.length; i++) {
        let value = answers[i];
        const synonyms = getSynonyms(answers[i]);
        if (synonyms && synonyms.length > 0) {
          value = synonyms[0].trim();
        }
        if (value.length > SUGGESTION_CHIPS_MAX_TEXT_LENGTH) {
          useList = true;
        }
        chips.push(value);
      }
      logger.debug(logObject('trivia', 'askQuestion', {
        info: 'hasScreen',
        chips: JSON.stringify(chips)
      }));
      if (chips.length === 0) {
        askQuestionAudioOnly();
        return;
      }
      if (question) {
        questionSsmlResponse.say(question);
      }
      questionSsmlResponse.pause(TTS_DELAY);
      questionSsmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_DING), 'ding');
      if (useList) {
        logger.debug(logObject('trivia', 'askQuestion', {
          info: 'askQuestion: list'
        }));
        const list = app.buildList();
        for (let i = 0; i < chips.length; i++) {
          const chip = chips[i];
          list.addItems(app.buildOptionItem(chip).setTitle(chip));
        }
        const richResponse = app.buildRichResponse()
          .addSimpleResponse(ssmlResponse.toString())
          .addSimpleResponse(questionSsmlResponse.toString());
        logger.debug(logObject('trivia', 'askQuestion', {
          info: 'askQuestion: list',
          richResponse: JSON.stringify(richResponse),
          list: JSON.stringify(list)
        }));
        app.askWithList(richResponse, list);
      } else {
        logger.debug(logObject('trivia', 'askQuestion', {
          info: 'askQuestion: suggestion chips'
        }));
        app.ask(app
          .buildRichResponse()
          .addSimpleResponse(ssmlResponse.toString())
          .addSimpleResponse(questionSsmlResponse.toString())
          .addSuggestions(chips));
      }
    } else {
      logger.debug(logObject('trivia', 'askQuestion', {
        info: 'No screen'
      }));
      askQuestionAudioOnly();
    }
  };

  // For ordinal responses, check that answer is in range
  const isValidAnswer = (answer, answers) => {
    return (answer && !isNaN(parseInt(answer)) &&
      parseInt(answer) < (answers.length + 1) && parseInt(answer) > 0);
  };

  // Generate the response for the next question
  const nextQuestion = (app, ssmlResponse) => {
    const sessionQuestions = app.data.sessionQuestions;
    const answers = app.data.sessionAnswers;
    gameLength = parseInt(app.data.gameLength);
    let currentQuestion = parseInt(app.data.currentQuestion);
    const score = parseInt(app.data.score);

    // Last question
    if (currentQuestion === gameLength - 1) {
      ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_ROUND_ENDED), 'round ended');
      ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.GAME_OVER_PROMPTS_1));
      ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.GAME_OVER_PROMPTS_2));
      ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_CALCULATING), 'calculating');
      ssmlResponse.pause(TTS_DELAY);
      if (score === gameLength) {
        ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.ALL_CORRECT_PROMPTS), score));
      } else if (score === 0) {
        ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.NONE_CORRECT_PROMPTS), score));
      } else {
        ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.SOME_CORRECT_PROMPTS), score));
      }
      ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.PLAY_AGAIN_QUESTION_PROMPTS));
      app.setContext(PLAY_AGAIN_CONTEXT);
      if (hasScreen) {
        app.ask(app
          .buildRichResponse()
          .addSimpleResponse(ssmlResponse.toString())
          .addSuggestions([utils.YES, utils.NO]));
      } else {
        app.ask(ssmlResponse.toString(), selectInputPrompts());
      }
      persistScore();
    } else {
      // Not the last question
      currentQuestion++;
      if (currentQuestion === gameLength - 1) {
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.FINAL_ROUND_PROMPTS));
      } else if (currentQuestion % 2 === 1) {
        ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.ROUND_PROMPTS), (currentQuestion + 1)));
      } else if (app.data.correct) {
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.NEXT_QUESTION_PROMPTS));
      } else {
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.QUESTION_PROMPTS));
      }
      ssmlResponse.pause(TTS_DELAY);
      const questionPrompt = sessionQuestions[currentQuestion];

      let correctIndex = 0;
      let selectedAnswers = [];
      const selectedQuestionAnswers = answers[currentQuestion];
      if (isTrueFalseQuestion(selectedQuestionAnswers)) {
        selectedAnswers = selectedQuestionAnswers.slice(0);
      } else {
        correctIndex = utils.getRandomNumber(0, selectedQuestionAnswers.length - 1);
        selectedAnswers = selectAnswers(correctIndex, selectedQuestionAnswers);
      }
      if (selectedAnswers) {
        app.data.selectedAnswers = selectedAnswers;
        app.data.correctAnswer = correctIndex;
        app.data.questionPrompt = questionPrompt;
        app.data.fallbackCount = 0;
        app.data.currentQuestion = currentQuestion;
        app.data.score = score;
        askQuestion(ssmlResponse, questionPrompt, selectedAnswers);
      } else {
        app.tell('There is a problem with the answers.');
      }
    }
  };

  // The user provided an ordinal answer
  const valueIntent = (app, choice, ssml) => {
    logger.info(logObject('trivia', 'valueIntent', {
      info: 'Handle value intent',
      rawInput: app.getRawInput(),
      choice: choice
    }));

    const selectedAnswers = app.data.selectedAnswers;
    const sessionFollowUps = app.data.sessionFollowUps;
    const currentQuestion = parseInt(app.data.currentQuestion);
    const correctAnswer = parseInt(app.data.correctAnswer);
    gameLength = parseInt(app.data.gameLength);
    let score = parseInt(app.data.score);

    let number;

    // Answers in mathematical format are matched to values by Dialogflow
    // Handle as special case by comparing raw input with expected value
    let found = false;
    if (!choice) {
      for (let i = 0; i < selectedAnswers.length; i++) {
        const synonyms = getSynonyms(selectedAnswers[i]);
        if (synonyms) {
          for (let j = 0; j < synonyms.length; j++) {
            if (utils.compareStrings(synonyms[j], app.getRawInput())) {
              number = i + 1;
              found = true;
              break;
            }
          }
        }
        if (found) {
          break;
        }
      }
    }

    // Value intent is reused for various intents that pass in their arguments
    // using different argument names
    if (!number) {
      number = app.getArgument('number');
    }
    if (!number) {
      number = app.getArgument('any');
    }
    if (!number) {
      number = app.getArgument('ordinal');
    }
    if (!number && last) {
      number = selectedAnswers.length.toString();
      last = false;
    }
    if (!number && middle) {
      number = (Math.floor(selectedAnswers.length / 2) + 1).toString();
      middle = false;
    }
    if (!number) {
      number = choice;
    }
    logger.debug(logObject('trivia', 'valueIntent', {
      info: 'Guessed number',
      number: number
    }));

    let ssmlResponse = new Ssml();
    if (ssml) {
      ssmlResponse = ssml;
    }

    const synonyms = getSynonyms(selectedAnswers[correctAnswer]);
    if (isValidAnswer(number, selectedAnswers)) {
      logger.debug(logObject('trivia', 'valueIntent', {
        info: 'Answer is valid',
        correctAnswer: correctAnswer
      }));
      const answer = parseInt(number);
      if ((correctAnswer + 1) === answer) {
        score++;
        app.data.correct = true;
        ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_CORRECT), 'correct');
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.RIGHT_ANSWER_PROMPTS_1));
        if (sessionFollowUps && sessionFollowUps[currentQuestion] && sessionFollowUps[currentQuestion].length > 0) {
          ssmlResponse.say(sessionFollowUps[currentQuestion]);
        }
      } else {
        app.data.correct = false;
        ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_INCORRECT), 'incorrect');
        if (synonyms && synonyms.length > 0) {
          ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.WRONG_ANSWER_PROMPTS_1)} ${
            sprintf(getRandomPrompt(PROMPT_TYPES.WRONG_ANSWER_PROMPTS_2), synonyms[0])}`);
        } else {
          ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.WRONG_ANSWER_PROMPTS_1));
        }
        if (sessionFollowUps && sessionFollowUps[currentQuestion] && sessionFollowUps[currentQuestion].length > 0) {
          ssmlResponse.say(sessionFollowUps[currentQuestion]);
        }
      }
      app.data.score = score;
      nextQuestion(app, ssmlResponse);
    } else {
      unknownIntent(app, true);
    }
  };

  // Default fallback intent handler
  const unknownIntent = (app, otherIntentTriggered) => {
    logger.info(logObject('trivia', 'unknownIntent', {
      info: 'Handling unknown intent',
      rawInput: app.getRawInput(),
      otherIntentTriggered: otherIntentTriggered
    }));

    // Keep track of how many times the user provides unknown input sequentially
    let fallbackCount = 0;
    if (app.data.fallbackCount === undefined) {
      fallbackCount = 0;
    } else {
      fallbackCount = parseInt(app.data.fallbackCount);
    }
    fallbackCount++;
    app.data.fallbackCount = fallbackCount;
    const selectedAnswers = app.data.selectedAnswers;

    // Check if the answer is amongst all the the answers for any of the questions
    const handleDictionaryInput = () => {
      // Provide three prompts before ending game
      const ssmlResponse = new Ssml();
      const correctAnswer = parseInt(app.data.correctAnswer);
      const synonyms = getSynonyms(selectedAnswers[correctAnswer]);
      app.data.correct = false;
      ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_INCORRECT), 'incorrect');
      if (synonyms && synonyms.length > 0) {
        ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.WRONG_ANSWER_FOR_QUESTION_PROMPTS)} ${
          sprintf(getRandomPrompt(PROMPT_TYPES.CORRECT_ANSWER_ONLY_PROMPTS), synonyms[0])}`);
      } else {
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.WRONG_ANSWER_FOR_QUESTION_PROMPTS));
      }
      nextQuestion(app, ssmlResponse);
    };

    const handleNonDictionaryInput = (inDictionary) => {
      // Provide three prompts before ending game
      const ssmlResponse = new Ssml();
      // Provide different response depending on the fallback count
      if (fallbackCount === 1) {
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.RAPID_REPROMPTS));
        app.ask(ssmlResponse.toString(), selectInputPrompts());
      } else if (fallbackCount === 2) {
        app.setContext(DONE_CONTEXT);
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.FALLBACK_PROMPT_1));
        if (hasScreen) {
          app.ask(app
            .buildRichResponse()
            .addSimpleResponse(ssmlResponse.toString())
            .addSuggestions([utils.YES, utils.NO]));
        } else {
          app.ask(ssmlResponse.toString(), selectInputPrompts());
        }
      } else {
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.FALLBACK_PROMPT_2));
        ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_GAME_OUTRO), 'game ending');
        app.tell(ssmlResponse.toString());
      }
    };

    // Try fuzzy and partial matching against the answers
    const rawInput = app.getRawInput().trim();
    if (!otherIntentTriggered && selectedAnswers) {
      const parts = rawInput.split(utils.SPACE);
      for (let i = 0; i < selectedAnswers.length; i++) {
        const synonyms = getSynonyms(selectedAnswers[i]);
        if (synonyms) {
          for (let j = 0; j < synonyms.length; j++) {
            if (utils.fuzzyMatch(synonyms[j], rawInput)) {
              logger.debug(logObject('trivia', 'unknownIntent', {
                info: 'Fuzzy matched',
                answer: i + 1
              }));
              valueIntent(app, i + 1, null);
              return;
            }
            // Check for partial matches of words
            for (let k = 0; k < parts.length; k++) {
              if (utils.compareStrings(parts[k], synonyms[j])) {
                logger.debug(logObject('trivia', 'unknownIntent', {
                  info: 'Partial match',
                  answer: i + 1
                }));
                valueIntent(app, i + 1, null);
                return;
              }
            }
          }
        }
      }
    }

    // Get the dictionary list of all possible answers
    firebaseAdmin.database().ref(`${DATABASE_DATA}/${DATABASE_PATH_DICTIONARY
        }${utils.encodeAsFirebaseKey(app.getRawInput().toLowerCase())}`)
      .once('value', (data) => {
        if (data && data.val()) {
          handleDictionaryInput();
        } else {
          handleNonDictionaryInput();
        }
      }, (error) => {
        if (error) {
          handleNonDictionaryInput();
        }
      });
  };

  // Handle user repeat request
  const repeatIntent = (app) => {
    logger.info(logObject('trivia', 'repeatIntent', {
      info: 'Handling repeat intent',
      rawInput: app.getRawInput()
    }));

    app.data.fallbackCount = 0;
    const ssmlResponse = new Ssml();
    ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.REPEAT_PROMPTS));
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user score request
  const scoreIntent = (app) => {
    logger.info(logObject('trivia', 'scoreIntent', {
      info: 'Handling score intent',
      rawInput: app.getRawInput()
    }));

    app.data.fallbackCount = 0;
    const ssmlResponse = new Ssml();
    ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.YOUR_SCORE_PROMPTS), app.data.score));
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user help request
  const helpIntent = (app) => {
    logger.info(logObject('trivia', 'helpIntent', {
      info: 'Handling help intent',
      rawInput: app.getRawInput()
    }));

    app.data.fallbackCount = 0;
    app.setContext(HELP_CONTEXT);
    const ssmlResponse = new Ssml();
    ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.HELP_PROMPTS), app.data.gameLength));
    if (hasScreen) {
      app.ask(app
        .buildRichResponse()
        .addSimpleResponse(ssmlResponse.toString())
        .addSuggestions([utils.YES, utils.NO]));
    } else {
      app.ask(ssmlResponse.toString(), selectInputPrompts());
    }
  };

  // Handle user quit request
  const quitIntent = (app) => {
    logger.info(logObject('trivia', 'quitIntent', {
      info: 'Handling quit intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    ssmlResponse.say(sprintf(getRandomPrompt(PROMPT_TYPES.END_PROMPTS), app.data.score, app.data.gameLength));
    ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_GAME_OUTRO), 'game ending');
    app.tell(ssmlResponse.toString());
  };

  // Handle user play again YES response (already in play again context)
  const playAgainYesIntent = (app) => {
    logger.info(logObject('trivia', 'playAgainYesIntent', {
      info: 'Handling play again yes intent',
      rawInput: app.getRawInput()
    }));

    startNewRound((error) => {
      if (error) {
        app.tell(error.message);
      } else {
        const ssmlResponse = new Ssml();
        ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.RE_PROMPT));
        ssmlResponse.pause(TTS_DELAY);
        askQuestion(ssmlResponse, questionPrompt, selectedAnswers);
      }
    });
  };

  // Handle user play again NO response (already in play again context)
  const playAgainNoIntent = (app) => {
    logger.info(logObject('trivia', 'playAgainNoIntent', {
      info: 'Handling play again no intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.QUIT_PROMPTS));
    ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_GAME_OUTRO), 'game ending');
    app.tell(ssmlResponse.toString());
  };

  // Handle user done YES response (already in done context)
  const doneYesIntent = (app) => {
    logger.info(logObject('trivia', 'doneYesIntent', {
      info: 'Handling done yes intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.QUIT_PROMPTS));
    ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_GAME_OUTRO), 'game ending');
    app.tell(ssmlResponse.toString());
  };

  // Handle user done NO response (already in done context)
  const doneNoIntent = (app) => {
    logger.info(logObject('trivia', 'doneNoIntent', {
      info: 'Handling done no intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    const currentQuestion = parseInt(app.data.currentQuestion);
    gameLength = parseInt(app.data.gameLength);
    app.data.fallbackCount = 0;

    // Already answered last question
    if (currentQuestion === gameLength - 1) {
      playAgainYesIntent(app);
      return;
    }

    ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.RE_PROMPT)} `);
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user don't know request
  const dontKnowIntent = (app) => {
    logger.info(logObject('trivia', 'dontKnowIntent', {
      info: 'Handling dont know intent',
      rawInput: app.getRawInput()
    }));

    const selectedAnswers = app.data.selectedAnswers;
    const correctAnswer = parseInt(app.data.correctAnswer);
    const synonyms = getSynonyms(selectedAnswers[correctAnswer]);
    const ssmlResponse = new Ssml();
    if (synonyms && synonyms.length > 0) {
      ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.SKIP_PROMPTS)} ${
        sprintf(getRandomPrompt(PROMPT_TYPES.CORRECT_ANSWER_ONLY_PROMPTS), synonyms[0])}`);
    } else {
      ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.SKIP_PROMPTS));
    }
    nextQuestion(app, ssmlResponse);
  };

  // Handle user answers request
  const answersIntent = (app) => {
    logger.info(logObject('trivia', 'answersIntent', {
      info: 'Handling answers intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    app.data.fallbackCount = 0;

    ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.REPEAT_PROMPTS)} `);
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user ordinal response for last answer
  const lastIntent = (app) => {
    logger.info(logObject('trivia', 'lastIntent', {
      info: 'Handling last intent',
      rawInput: app.getRawInput()
    }));

    last = true;
    valueIntent(app, null, null);
  };

  // Handle user ordinal response for the middle answer
  const middleIntent = (app) => {
    logger.info(logObject('trivia', 'middleIntent', {
      info: 'Handling middle intent',
      rawInput: app.getRawInput()
    }));

    middle = true;
    valueIntent(app, null, null);
  };

  // Handler for deeplinks
  const unhandledDeeplinksIntent = (app) => {
    logger.info(logObject('trivia', 'unhandledDeeplinksIntent', {
      info: 'Handling unhandled deep link intent',
      rawInput: app.getRawInput()
    }));
    const text = app.getArgument(RAW_TEXT_ARGUMENT);
    if (text) {
      mainIntent(app, getRandomPrompt(PROMPT_TYPES.DEEPLINK_PROMPT));
    } else {
      mainIntent(app);
    }
  };

  // Handle user hint request
  const hintIntent = (app) => {
    logger.info(logObject('trivia', 'hintIntent', {
      info: 'Handling hint intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    app.data.fallbackCount = 0;

    ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.HINT_PROMPTS)} `);
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user disagree request
  const disagreeIntent = (app) => {
    logger.info(logObject('trivia', 'disagreeIntent', {
      info: 'Handling disagree intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    app.data.fallbackCount = 0;

    ssmlResponse.say(`${getRandomPrompt(PROMPT_TYPES.DISAGREE_PROMPTS)} `);
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user answer response
  const answerIntent = (app) => {
    logger.info(logObject('trivia', 'answerIntent', {
      info: 'Handling answer intent',
      rawInput: app.getRawInput()
    }));

    let answer = 0;
    const handleAnswer = (answer) => {
      logger.debug(logObject('trivia', 'answerIntent', {
        info: 'Handling answer intent',
        answer: answer
      }));
      valueIntent(app, answer, null);
    };

    // Catch the answer being repeated
    const contexts = app.getContexts();
    if (contexts) {
      for (let i = 0; i < contexts.length; i++) {
        const context = contexts[i];
        if (context.name === PLAY_AGAIN_CONTEXT) {
          if (app.data.fallbackCount > 0) {
            doneYesIntent(app);
          } else if (app.data.rawInput === app.getRawInput()) {
            app.data.fallbackCount++;
            app.setContext(DONE_CONTEXT);
            const ssmlResponse = new Ssml();
            ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.FALLBACK_PROMPT_1));
            if (hasScreen) {
              app.ask(app
                .buildRichResponse()
                .addSimpleResponse(ssmlResponse.toString())
                .addSuggestions([utils.YES, utils.NO]));
            } else {
              app.ask(ssmlResponse.toString(), selectInputPrompts());
            }
            return;
          }
        } else if (context.name === DONE_CONTEXT) {
          doneYesIntent(app);
          return;
        }
      }
    }
    app.data.rawInput = app.getRawInput();

    // Check if answer value is in the expected list of synonyms for the answer
    const choice = app.getArgument(ANSWER_ARGUMENT).trim();
    const selectedAnswers = app.data.selectedAnswers;
    let answered = false;
    if (selectedAnswers) {
      const correctAnswer = parseInt(app.data.correctAnswer);
      const synonyms = getSynonyms(selectedAnswers[correctAnswer]);
      if (utils.compareStrings(app.getRawInput(), synonyms[0])) {
        answered = true;
        answer = correctAnswer + 1;
      } else {
        for (let i = 0; i < selectedAnswers.length; i++) {
          const synonyms = getSynonyms(selectedAnswers[i]);
          if (synonyms && synonyms.length > 0) {
            for (let j = 0; j < synonyms.length; j++) {
              if (utils.compareStrings(synonyms[j], choice)) {
                answered = true;
                answer = i + 1;
                break;
              }
            }
            if (answered) {
              break;
            }
          }
        }
      }
    }
    if (answered) {
      handleAnswer(answer);
    } else {
      // Could be the entity key of another answer.
      // For each synonym of the entity key for the user's answer,
      // check if it matches the synonyms of the expected answer.
      generateSynonyms([choice], (err, results) => {
        if (!err) {
          const entities = getSynonyms(results[0]);
          if (entities && selectedAnswers) {
            for (let i = 0; i < selectedAnswers.length; i++) {
              const synonyms = getSynonyms(selectedAnswers[i]);
              if (synonyms) {
                for (let j = 1; j < synonyms.length; j++) {
                  for (let k = 1; k < entities.length; k++) {
                    if (utils.compareStrings(synonyms[j], entities[k])) {
                      answered = true;
                      answer = i + 1;
                      break;
                    }
                  }
                  if (answered) {
                    break;
                  }
                }
              }
              if (answered) {
                break;
              }
            }
          }
        }
        if (!answered) {
          unknownIntent(app, true);
        } else {
          handleAnswer(answer);
        }
      });
    }
  };

  // Handle the mistaken user response
  const mistakenIntent = (app) => {
    logger.info(logObject('trivia', 'mistakenIntent', {
      info: 'Handling mistaken intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    app.data.fallbackCount = 0;

    ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.PLAY_AGAIN_QUESTION_PROMPTS));
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle user feeling lucky response
  const feelingLuckyIntent = (app) => {
    logger.info(logObject('trivia', 'feelingLuckyIntent', {
      info: 'Handling feeling lucky intent',
      rawInput: app.getRawInput()
    }));

    // Handle YES/NO contexts first
    const contexts = app.getContexts();
    for (let i = 0; i < contexts.length; i++) {
      const context = contexts[i];
      if (context.name === PLAY_AGAIN_CONTEXT) {
        playAgainYesIntent(app);
        return;
      } else if (context.name === DONE_CONTEXT) {
        doneNoIntent(app);
        return;
      }
    }
    // Randomly select an answer
    const selectedAnswers = app.data.selectedAnswers;
    const answer = utils.getRandomNumber(0, selectedAnswers.length - 1);
    const ssmlResponse = new Ssml();
    ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.FEELING_LUCKY_PROMPTS));
    ssmlResponse.audio(getRandomAudio(AUDIO_TYPES.AUDIO_CALCULATING), 'calculating');
    ssmlResponse.pause(TTS_DELAY);
    const synonyms = getSynonyms(selectedAnswers[answer]);
    if (synonyms && synonyms.length > 0) {
      ssmlResponse.say(synonyms[0]);
    }
    ssmlResponse.pause(TTS_DELAY);
    valueIntent(app, answer + 1, ssmlResponse);
  };

  // Handle true response for TRUE/FALSE questions
  const trueIntent = (app) => {
    logger.info(logObject('trivia', 'trueIntent', {
      info: 'Handling true intent',
      rawInput: app.getRawInput()
    }));

    let answer = 0;
    const choice = utils.TRUE;
    const selectedAnswers = app.data.selectedAnswers;
    for (let i = 0; i < selectedAnswers.length; i++) {
      const synonyms = getSynonyms(selectedAnswers[i]);
      if (synonyms && synonyms.length > 0 &&
          utils.compareStrings(synonyms[0], choice)) {
        answer = i + 1;
        break;
      }
    }
    valueIntent(app, answer, null);
  };

  // Handle false response for TRUE/FALSE questions
  const falseIntent = (app) => {
    logger.info(logObject('trivia', 'falseIntent', {
      info: 'Handling false intent',
      rawInput: app.getRawInput()
    }));

    let answer = 0;
    const choice = utils.FALSE;
    const selectedAnswers = app.data.selectedAnswers;
    for (let i = 0; i < selectedAnswers.length; i++) {
      const synonyms = getSynonyms(selectedAnswers[i]);
      if (synonyms && synonyms.length > 0 &&
          utils.compareStrings(synonyms[0], choice)) {
        answer = i + 1;
        break;
      }
    }
    valueIntent(app, answer, null);
  };

  // Handle yes response to help request
  const helpYesIntent = (app) => {
    logger.info(logObject('trivia', 'helpYesIntent', {
      info: 'Handling help yes intent',
      rawInput: app.getRawInput()
    }));

    const ssmlResponse = new Ssml();
    ssmlResponse.say(getRandomPrompt(PROMPT_TYPES.REPEAT_PROMPTS));
    askQuestion(ssmlResponse, app.data.questionPrompt, app.data.selectedAnswers);
  };

  // Handle multi-modal suggestion chips selection
  const listIntent = (app) => {
    logger.info(logObject('trivia', 'listIntent', {
      info: 'Handling list intent',
      rawInput: app.getRawInput()
    }));

    let answer = 0;
    const choice = app.getSelectedOption();
    logger.debug(logObject('trivia', 'listIntent', {
      info: 'User selection from list',
      choice: choice
    }));
    const selectedAnswers = app.data.selectedAnswers;
    for (let i = 0; i < selectedAnswers.length; i++) {
      const synonyms = getSynonyms(selectedAnswers[i]);
      if (synonyms && synonyms.length > 0 &&
          utils.compareStrings(synonyms[0], choice)) {
        answer = i + 1;
        break;
      }
    }
    logger.debug(logObject('trivia', 'listIntent', {
      info: 'Handling list intent',
      answer: answer
    }));
    valueIntent(app, answer, null);
  };

  const actionMap = new Map();
  actionMap.set(MAIN_INTENT, mainIntent);
  actionMap.set(VALUE_INTENT, valueIntent);
  actionMap.set(UNKNOWN_INTENT, unknownIntent);
  actionMap.set(REPEAT_INTENT, repeatIntent);
  actionMap.set(SCORE_INTENT, scoreIntent);
  actionMap.set(HELP_INTENT, helpIntent);
  actionMap.set(QUIT_INTENT, quitIntent);
  actionMap.set(PLAY_AGAIN_YES_INTENT, playAgainYesIntent);
  actionMap.set(PLAY_AGAIN_NO_INTENT, playAgainNoIntent);
  actionMap.set(DONE_YES_INTENT, doneYesIntent);
  actionMap.set(DONE_NO_INTENT, doneNoIntent);
  actionMap.set(NEW_INTENT, playAgainYesIntent);
  actionMap.set(HELP_YES_INTENT, helpYesIntent);
  actionMap.set(HELP_NO_INTENT, doneYesIntent);
  actionMap.set(DONT_KNOW_INTENT, dontKnowIntent);
  actionMap.set(ORDINAL_INTENT, valueIntent);
  actionMap.set(ANSWERS_INTENT, answersIntent);
  actionMap.set(LAST_INTENT, lastIntent);
  actionMap.set(MIDDLE_INTENT, middleIntent);
  actionMap.set(UNKNOWN_DEEPLINK_ACTION, unhandledDeeplinksIntent);
  actionMap.set(HINT_INTENT, hintIntent);
  actionMap.set(DISAGREE_INTENT, disagreeIntent);
  actionMap.set(ANSWER_INTENT, answerIntent);
  actionMap.set(MISTAKEN_INTENT, mistakenIntent);
  actionMap.set(FEELING_LUCKY_INTENT, feelingLuckyIntent);
  actionMap.set(TRUE_INTENT, trueIntent);
  actionMap.set(FALSE_INTENT, falseIntent);
  actionMap.set(ITEM_INTENT, listIntent);

  app.handleRequest(actionMap);
});
