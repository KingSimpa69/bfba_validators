// Deps ////////////////////////////////////////////////////////////////////////////////////

require('dotenv').config();
const express = require('express');
const app = express();
const { ethers } = require('ethers');
const ABI = require('./abi.json')
const { arrayCompare,findSequence,getImageAsBase64 } = require('./functions')
const semaphore = require('semaphore');
let validator
const sem = semaphore(1);

// Blockchain config ///////////////////////////////////////////////////////////////////////

const nativeProvider = new ethers.providers.JsonRpcProvider(process.env.NATIVE_RPC);
const receiverProvider = new ethers.providers.JsonRpcProvider(process.env.RECEIVER_RPC);  

const nativeSigner = new ethers.Wallet(process.env.CALLBACK_SECRET, nativeProvider);
const receiverSigner = new ethers.Wallet(process.env.CALLBACK_SECRET, receiverProvider);

const nativeContract = new ethers.Contract(
  process.env.NATIVE_CONTRACT,
  ABI.nativeContract,
  nativeSigner
);

const receiverContract = new ethers.Contract(
  process.env.RECEIVER_CONTRACT,
  ABI.receiverContract,
  receiverSigner
);

// Listeners /////////////////////////////////////////////////////////////////////////////////

nativeContract.on('NFTLocked', async (tokenId, owner, event) => {
  sem.take(async () => {
  console.log(`NOUN ${tokenId} [ETH2BASE] bridge initiated by ${owner}`);
  try{
    await nativeProvider.waitForTransaction(event.transactionHash, 5);
    const firstValidator = await nativeContract.authorities(0)
    if(validator === firstValidator){
      const locked = await nativeContract.lockedNFTs(tokenId)
      if(!locked){
        console.log("VALIDATOR COMPROMISED! EXITING !")
        return
      }
      const gasPrice = await receiverProvider.getGasPrice();
      const gasLimit = await receiverContract.estimateGas.validate(tokenId,owner);
      const tx = await receiverContract.validate(tokenId,owner,{gasLimit: gasLimit, gasPrice: gasPrice})
      await tx.wait()
    }
  } catch (e) {
    console.log(e)
  } finally {
    sem.leave();
  }
  })
});

receiverContract.on('Validated', async (tokenId, receiver, prevValidator, event) => {
  sem.take(async () => {
  console.log(`NOUN ${tokenId} [ETH2BASE] VALIDATED BY ${prevValidator}`);
  try{
    const receiverValidators = await receiverContract.getAuthorities()
    const isNext = await findSequence(receiverValidators,prevValidator)
    if(isNext === validator){
      await receiverProvider.waitForTransaction(event.transactionHash, 5);
      const locked = await nativeContract.lockedNFTs(tokenId)
      if(!locked){
        console.log("VALIDATOR COMPROMISED! EXITING !")
        return
      }
      const gasPrice = await receiverProvider.getGasPrice();
      const gasLimit = await receiverContract.estimateGas.validate(tokenId,receiver);
      const tx = await receiverContract.validate(tokenId,receiver,{gasLimit: gasLimit, gasPrice: gasPrice})
      await tx.wait()
    }
    if(isNext === undefined && receiverValidators[2] === validator){
      const image = await getImageAsBase64(tokenId);
      const gasPrice = await receiverProvider.getGasPrice();
      const gasLimit = await receiverContract.estimateGas.bridgeReceive(tokenId,receiver,image);
      await receiverProvider.waitForTransaction(event.transactionHash, 5);
      const tx = await receiverContract.bridgeReceive(tokenId,receiver,image,{gasLimit: gasLimit, gasPrice: gasPrice})
      await tx.wait()
    }
  } catch (e) {
    console.log(e)
  } finally {
    sem.leave();
  }
  })
});

receiverContract.on('NFTUnlocked', async (tokenId, recipient, event) => {
  console.log(`NOUN ${tokenId} [ETH2BASE] bridge to ${recipient} success!`);
});

receiverContract.on('NFTLocked', async (tokenId, owner, event) => {
  sem.take(async () => {
  console.log(`NOUN ${tokenId} [BASE2ETH] bridge initiated by ${owner}`);
  try{
    await receiverProvider.waitForTransaction(event.transactionHash, 5);
    const firstValidator = await nativeContract.authorities(0)
    if(validator === firstValidator){
      const locked = await receiverContract.lockedNFTs(tokenId)
      if(!locked){
        console.log("VALIDATOR COMPROMISED! EXITING !")
        return
      }
      const gasPrice = await nativeProvider.getGasPrice();
      const gasLimit = await nativeContract.estimateGas.validate(tokenId,owner);
      const tx = await nativeContract.validate(tokenId,owner,{gasLimit: gasLimit, gasPrice: gasPrice})
      await tx.wait()
    }
  } catch (e) {
    console.log(e)
  } finally {
    sem.leave();
  }
  })
});

nativeContract.on('Validated', async (tokenId, receiver, prevValidator, event) => {
  sem.take(async () => {
  console.log(`NOUN ${tokenId} [BASE2ETH] VALIDATED BY ${prevValidator}`);
  try{
    const receiverValidators = await nativeContract.getAuthorities()
    const isNext = await findSequence(receiverValidators,prevValidator)
    if(isNext === validator){
      await nativeProvider.waitForTransaction(event.transactionHash, 5);
      const locked = await receiverContract.lockedNFTs(tokenId)
      if(!locked){
        console.log("VALIDATOR COMPROMISED! EXITING !")
        return
      }
      const gasPrice = await nativeProvider.getGasPrice();
      const gasLimit = await nativeContract.estimateGas.validate(tokenId,receiver);
      const tx = await nativeContract.validate(tokenId,receiver,{gasLimit: gasLimit, gasPrice: gasPrice})
      await tx.wait()
    }
    if(isNext === undefined && receiverValidators[2] === validator){
      const gasPrice = await nativeProvider.getGasPrice();
      const gasLimit = await nativeContract.estimateGas.bridgeReceive(tokenId,receiver);
      await nativeProvider.waitForTransaction(event.transactionHash, 5);
      const tx = await nativeContract.bridgeReceive(tokenId,receiver,{gasLimit: gasLimit, gasPrice: gasPrice})
      await tx.wait()
    }
  } catch (e) {
    console.log(e)
  } finally {
    sem.leave();
  }
  })
});

nativeContract.on('NFTUnlocked', async (tokenId, recipient, event) => {
  console.log(`NOUN ${tokenId} [BASE2ETH] bridge to ${recipient} success!`);
});

app.use(express.json());

app.listen(process.env.PORT, async () => {
  try{
    const nativeValidators = await nativeContract.getAuthorities()
    const receiverValidators = await receiverContract.getAuthorities()
    const validatorsMatch = await arrayCompare(nativeValidators,receiverValidators)
    const nativeIndex = nativeValidators.indexOf(nativeSigner.address);
    const receiverIndex = receiverValidators.indexOf(receiverSigner.address);
    if(validatorsMatch && nativeIndex === receiverIndex){
      validator = nativeSigner.address
      console.log("===========================================================")
      console.log(`Validator checks passed.`)
      console.log("===========================================================")
      console.log(`BFBA validator running on port ${process.env.PORT}`);
      console.log("[ETH] "+nativeSigner.address)
      console.log("[BASE] "+receiverSigner.address)
      console.log("===========================================================")
    } else {
        console.log("Validator checks failed. Shutting down...");     
        process.exit(0); 
    }
  } catch (e) {
      console.log("Validator checks failed. Shutting down...");     
      process.exit(0); 
  }
});
