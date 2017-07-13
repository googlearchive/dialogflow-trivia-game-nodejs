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
 * Utilities
 */

const logger = require('winston').loggers.get('DEFAULT_LOGGER');

const Levenshtein = require('levenshtein');
const firebaseEncode = require('firebase-encode');

const YES = 'yes';
const NO = 'no';
const TRUE = 'true';
const FALSE = 'false';

const SEPARATOR = '|';
const SPACE = ' ';

// Logging object to provide context
const logObject = (moduleName, methodName, contextObject) => {
  return {
    module: moduleName,
    method: methodName,
    context: contextObject
  };
};

// Get a random number within a range
const getRandomNumber = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Get a random item from an array
const getRandomItem = (array) => {
  return array[Math.floor(Math.random() * (array.length))];
};

// Encode values for keys in a Firebase database
const encodeAsFirebaseKey = (string) => {
  return firebaseEncode.encode(string);
};

// Confirm if the values are TRUE/FALSE
const isTrueFalse = (answers) => {
  if (answers && answers.length === 2) {
    const answer1 = answers[0].toLowerCase();
    const answer2 = answers[1].toLowerCase();
    if ((answer1 === TRUE && answer2 === FALSE) ||
        (answer2 === TRUE && answer1 === FALSE)) {
      return true;
    }
  }
  return false;
};

// Clean the value of punctuation characters
const removePunctuationAndSpaces = (value) => {
  value = value.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '');
  return value.replace(/ /g, '');
};

// Do a fuzzy comparison of strings: lowercase, remove punctuation,
// at least 3 chars and char diff isn't more than 1
const fuzzyMatch = (value1, value2) => {
  value1 = removePunctuationAndSpaces(value1.toLowerCase());
  value2 = removePunctuationAndSpaces(value2.toLowerCase());
  return (value1.length > 3 && value2.length > 3) &&
    (new Levenshtein(value1, value2).distance <= 1);
};

// Compare strings by ignoring case
const compareStrings = (string1, string2) => {
  if (string1 && string2) {
    return string1.toLocaleLowerCase().trim() === string2.toLocaleLowerCase().trim();
  }
  return false;
};

// Generate synonyms from value by breaking up into words
const generateSynonyms = (values, mainCallback) => {
  logger.debug(logObject('language', 'generateSynonyms', {
    info: 'Generate synonyms',
    values: values
  }));
  const synonyms = [];

  const isIgnorableWord = (result) => {
    if (result === 'the' || result === 'a' || result === 'and' ||
        result === 'or' || result === '&' || result === 'of' ||
        result === 'for' || result === 'an' || result === 'by') {
      return true;
    }
    return false;
  };

  const findAllSynonyms = (values, callback) => {
    // For each value, find its set of synonyms
    // Basic string splitting
    for (let j = 0; j < values.length; j++) {
      const value = values[j].trim();
      if (value.indexOf(SEPARATOR) === -1) {
        const results = value.split(' ');
        for (let i = results.length - 1; i >= 0; i--) {
          const result = results[i].toLowerCase().trim();
          if (isIgnorableWord(result)) {
            results.splice(i, 1);
          }
        }
        if (results.indexOf(value) === -1) {
          synonyms[value] = [value].concat(results);
        } else {
          synonyms[value] = results;
        }
      } else {
        // Generate synonyms for each synonym provided by user
        const allValues = [value];
        const splits = value.split(SEPARATOR);
        for (let k = 0; k < splits.length; k++) {
          const value = splits[k].trim();
          const results = value.split(' ');
          for (let l = results.length - 1; l >= 0; l--) {
            const result = results[l].toLowerCase().trim();
            if (isIgnorableWord(result)) {
              results.splice(l, 1);
            }
          }
          for (let l = 0; l < results.length; l++) {
            if (allValues.indexOf(results[l]) === -1) {
              allValues.push(results[l]);
            }
          }
        }
        synonyms[value] = allValues;
      }
    }
    callback();
  };

  findAllSynonyms(values.slice(0), () => {
    // Remove all duplicate synonyms amongst all the values
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const valueSynonyms = synonyms[value];
      if (valueSynonyms) {
        const valueSynonymsClone = valueSynonyms.slice(0);
        for (const key in synonyms) {
          if (key !== value) {
            const otherSynonyms = synonyms[key];
            const otherSynonymsClone = otherSynonyms.slice(0);
            for (let j = 0; j < valueSynonymsClone.length; j++) {
              const result = valueSynonymsClone[j];
              const index = otherSynonymsClone.indexOf(result);
              if (index !== -1) {
                otherSynonyms.splice(otherSynonyms.indexOf(result), 1);
                if (valueSynonyms.indexOf(result) !== -1) {
                  valueSynonyms.splice(valueSynonyms.indexOf(result), 1);
                }
              }
            }
          }
        }
      }
    }
    const results = [];
    // Retain values order
    for (let i = 0; i < values.length; i++) {
      const key = values[i].trim();
      const synonym = synonyms[key];
      if (synonym && synonym.length) {
        results.push(synonym.join(SEPARATOR));
      } else {
        results.push(key);
      }
    }
    mainCallback(null, results);
  });
};

// Extract synonyms for answers separated with | char
const getSynonyms = (value) => {
  if (value) {
    const synonyms = value.split(SEPARATOR);
    for (let i = 0; i < synonyms.length; i++) {
      synonyms[i] = synonyms[i].trim();
    }
    return synonyms;
  }
  return [];
};

module.exports = {
  getRandomNumber: getRandomNumber,
  getRandomItem: getRandomItem,
  encodeAsFirebaseKey: encodeAsFirebaseKey,
  SEPARATOR: SEPARATOR,
  SPACE: SPACE,
  YES: YES,
  NO: NO,
  FALSE: FALSE,
  TRUE: TRUE,
  isTrueFalse: isTrueFalse,
  fuzzyMatch: fuzzyMatch,
  compareStrings: compareStrings,
  generateSynonyms: generateSynonyms,
  logObject: logObject,
  getSynonyms: getSynonyms
};
