import{a as n}from"./chunk-TQUQSDWQ.js";import{a as e}from"./chunk-4MOED6VN.js";import"./chunk-VC46IEJQ.js";var t="rgbdEncodePixelShader",a=`varying vUV: vec2f;var textureSamplerSampler: sampler;var textureSampler: texture_2d<f32>;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {fragmentOutputs.color=toRGBD(textureSample(textureSampler,textureSamplerSampler,input.vUV).rgb);}`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=a);var S=[n];for(let r of S)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);var s={name:t,shader:a};export{s as rgbdEncodePixelShaderWGSL};
