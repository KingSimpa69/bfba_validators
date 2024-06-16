const fetch = require('node-fetch');

const arrayCompare = async(arr1, arr2) => {

    if (arr1.length !== arr2.length) return false;

    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) {
            return false;
        }
    }

    return true;
}

const findSequence = async (array, currentItem) => {
    const currentIndex = array.indexOf(currentItem);

    if (currentIndex === -1) return undefined; 
    const nextIndex = currentIndex + 1;

    return array[nextIndex];
}

const getImageAsBase64 = async (id) => {
    const response = await fetch(`https://nounsonbase.builders/nouns/${id}`);
    const buffer = await response.buffer(); 
    const base64 = buffer.toString('base64');
    return base64;
}

exports.arrayCompare = arrayCompare;
exports.findSequence = findSequence;
exports.getImageAsBase64 = getImageAsBase64;