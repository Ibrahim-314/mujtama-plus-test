import{a as t}from"./chunk-74A6MLLS.js";import{a as e}from"./chunk-4MOED6VN.js";import"./chunk-VC46IEJQ.js";var o="extractHighlightsPixelShader",a=`#include<helperFunctions>
varying vec2 vUV;uniform sampler2D textureSampler;uniform float threshold;uniform float exposure;
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=texture2D(textureSampler,vUV);float luma=dot(LuminanceEncodeApprox,gl_FragColor.rgb*exposure);gl_FragColor.rgb=step(threshold,luma)*gl_FragColor.rgb;}`;e.ShadersStore[o]||(e.ShadersStore[o]=a);var l=[t];for(let r of l)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);var s={name:o,shader:a};export{s as extractHighlightsPixelShader};
