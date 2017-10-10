// Copyright 2017, Google, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

/**
 * Utility class to manage theme prompts and audio resources
 */

// Logging dependencies
const winston = require('winston');
const logger = winston.loggers.get('DEFAULT_LOGGER');
const { logObject } = require('./utils');
const utils = require('./utils');

const THEME_TYPES = {
  TRIVIA_TEACHER_THEME: 'Teacher',
  TRIVIA_QUEEN_THEME: 'Queen',
  TRIVIA_TRIVIA_BOT_THEME: 'TriviaBot'
};

const PROMPT_TYPES = {
  GREETING_PROMPTS_1: 'GREETING_PROMPTS_1',
  GREETING_PROMPTS_2: 'GREETING_PROMPTS_2',
  RE_PROMPT: 'RE_PROMPT',
  QUIT_PROMPTS: 'QUIT_PROMPTS',
  PLAY_AGAIN_QUESTION_PROMPTS: 'PLAY_AGAIN_QUESTION_PROMPTS',
  FALLBACK_PROMPT_1: 'FALLBACK_PROMPT_1',
  FALLBACK_PROMPT_2: 'FALLBACK_PROMPT_2',
  DEEPLINK_PROMPT: 'DEEPLINK_PROMPT',
  REPEAT_PROMPTS: 'REPEAT_PROMPTS',
  SKIP_PROMPTS: 'SKIP_PROMPTS',
  RIGHT_ANSWER_PROMPTS_1: 'RIGHT_ANSWER_PROMPTS_1',
  WRONG_ANSWER_PROMPTS_1: 'WRONG_ANSWER_PROMPTS_1',
  RIGHT_ANSWER_PROMPTS_2: 'RIGHT_ANSWER_PROMPTS_2',
  WRONG_ANSWER_PROMPTS_2: 'WRONG_ANSWER_PROMPTS_2',
  HINT_PROMPTS: 'HINT_PROMPTS',
  GAME_OVER_PROMPTS_1: 'GAME_OVER_PROMPTS_1',
  GAME_OVER_PROMPTS_2: 'GAME_OVER_PROMPTS_2',
  NONE_CORRECT_PROMPTS: 'NONE_CORRECT_PROMPTS',
  SOME_CORRECT_PROMPTS: 'SOME_CORRECT_PROMPTS',
  ALL_CORRECT_PROMPTS: 'ALL_CORRECT_PROMPTS',
  INTRODUCTION_PROMPTS: 'INTRODUCTION_PROMPTS',
  RANGE_PROMPTS: 'RANGE_PROMPTS',
  QUESTIONS_COUNT_PROMPTS: 'QUESTIONS_COUNT_PROMPTS',
  LETS_PLAY_PROMPTS: 'LETS_PLAY_PROMPTS',
  ROUND_PROMPTS: 'ROUND_PROMPTS',
  QUESTION_PROMPTS: 'QUESTION_PROMPTS',
  FIRST_ROUND_PROMPTS: 'FIRST_ROUND_PROMPTS',
  FINAL_ROUND_PROMPTS: 'FINAL_ROUND_PROMPTS',
  NO_INPUT_PROMPTS_1: 'NO_INPUT_PROMPTS_1',
  NO_INPUT_PROMPTS_2: 'NO_INPUT_PROMPTS_2',
  NO_INPUT_PROMPTS_3: 'NO_INPUT_PROMPTS_3',
  SAY_NUMBER_PROMPTS: 'SAY_NUMBER_PROMPTS',
  YOUR_SCORE_PROMPTS: 'YOUR_SCORE_PROMPTS',
  HELP_PROMPTS: 'HELP_PROMPTS',
  END_PROMPTS: 'END_PROMPTS',
  CORRECT_ANSWER_PROMPTS: 'CORRECT_ANSWER_PROMPTS',
  CORRECT_ANSWER_ONLY_PROMPTS: 'CORRECT_ANSWER_ONLY_PROMPTS',
  STOP_PROMPTS: 'STOP_PROMPTS',
  DISAGREE_PROMPTS: 'DISAGREE_PROMPTS',
  FEELING_LUCKY_PROMPTS: 'FEELING_LUCKY_PROMPTS',
  NEXT_QUESTION_PROMPTS: 'NEXT_QUESTION_PROMPTS',
  NEXT_QUESTION_PROMPTS_1: 'NEXT_QUESTION_PROMPTS_1',
  NEXT_QUESTION_PROMPTS_2: 'NEXT_QUESTION_PROMPTS_2',
  ASK_HINT_PROMPTS: 'ASK_HINT_PROMPTS',
  LETS_PLAY_PROMPTS_1: 'LETS_PLAY_PROMPTS_1',
  LETS_PLAY_PROMPTS_2: 'LETS_PLAY_PROMPTS_2',
  QUESTION_PROMPTS_1: 'QUESTION_PROMPTS_1',
  QUESTION_PROMPTS_2: 'QUESTION_PROMPTS_2',
  RULES_PROMPTS: 'RULES_PROMPTS',
  TRUE_FALSE_PROMPTS: 'TRUE_FALSE_PROMPTS',
  RAPID_REPROMPTS: 'RAPID_REPROMPTS',
  WRONG_ANSWER_FOR_QUESTION_PROMPTS: 'WRONG_ANSWER_FOR_QUESTION_PROMPTS'
};

const AUDIO_TYPES = {
  AUDIO_GAME_INTRO: 'AUDIO_GAME_INTRO',
  AUDIO_GAME_OUTRO: 'AUDIO_GAME_OUTRO',
  AUDIO_DING: 'AUDIO_DING',
  AUDIO_CORRECT: 'AUDIO_CORRECT',
  AUDIO_INCORRECT: 'AUDIO_INCORRECT',
  AUDIO_ROUND_ENDED: 'AUDIO_ROUND_ENDED',
  AUDIO_CALCULATING: 'AUDIO_CALCULATING'
};

const teacherPrompts = require('./data/teacherPrompts.json');
const triviaBotPrompts = require('./data/triviaBotPrompts.json');
const queenPrompts = require('./data/queenPrompts.json');
const teacherAudio = require('./data/teacherAudio.json');
const triviaBotAudio = require('./data/triviaBotAudio.json');
const queenAudio = require('./data/queenAudio.json');

// Class to manage loading and accessing the theme prompts and audio resources
const Themes = class {
  constructor () {
    logger.debug(logObject('themes', 'constructor', {
      info: 'Templates instance created'
    }));

    this.prompts = [];
    this.prompts[THEME_TYPES.TRIVIA_TEACHER_THEME] = teacherPrompts;
    this.prompts[THEME_TYPES.TRIVIA_QUEEN_THEME] = queenPrompts;
    this.prompts[THEME_TYPES.TRIVIA_TRIVIA_BOT_THEME] = triviaBotPrompts;
    this.audio = [];
    this.audio[THEME_TYPES.TRIVIA_TEACHER_THEME] = teacherAudio;
    this.audio[THEME_TYPES.TRIVIA_QUEEN_THEME] = queenAudio;
    this.audio[THEME_TYPES.TRIVIA_TRIVIA_BOT_THEME] = triviaBotAudio;
  }

  // Get prompts for theme and type
  getPrompts (theme, type) {
    logger.debug(logObject('themes', 'getPrompts', {
      info: 'Get VUI prompts',
      theme: theme,
      type: type
    }));
    if (theme && type) {
      if (this.prompts && this.prompts[theme] && this.prompts[theme][type]) {
        return this.prompts[theme][type];
      }
    }
    return null;
  }

  // Select a random audio track
  getRandomAudio (theme, type) {
    logger.debug(logObject('themes', 'getRandomAudio', {
      info: 'Get random audio',
      theme: theme,
      type: type
    }));
    if (theme && type) {
      if (this.audio && this.audio[theme] && this.audio[theme][type]) {
        return utils.getRandomItem(this.audio[theme][type]);
      }
    }
    return null;
  }

  // Select a random prompt, avoiding the last prompt
  getRandomPrompt (theme, type, lastPrompt) {
    logger.debug(logObject('themes', 'getRandomPrompt', {
      info: 'Get random prompt',
      theme: theme,
      type: type,
      lastPrompt: lastPrompt
    }));
    if (theme && type) {
      const prompts = this.getPrompts(theme, type);
      if (prompts) {
        let prompt = utils.getRandomItem(prompts);
        if (lastPrompt) {
          let counter = 1;
          while (prompt === lastPrompt && counter < prompts.length) {
            counter++;
            prompt = utils.getRandomItem(prompts);
          }
        }
        return prompt;
      }
    }
    return `Missing prompts: ${type}`;
  }
};

module.exports = {
  AUDIO_TYPES: AUDIO_TYPES,
  Themes: Themes,
  THEME_TYPES: THEME_TYPES,
  PROMPT_TYPES: PROMPT_TYPES
};
