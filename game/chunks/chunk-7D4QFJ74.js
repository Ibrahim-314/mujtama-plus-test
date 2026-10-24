import{a as e}from"./chunk-4MOED6VN.js";var o="fogVertexDeclaration",n=`#ifdef FOG
varying vec3 vFogDistance;
#endif
`;e.IncludesShadersStore[o]||(e.IncludesShadersStore[o]=n);var i={name:o,shader:n};var t="fogVertex",s=`#ifdef FOG
vFogDistance=(view*worldPos).xyz;
#endif
`;e.IncludesShadersStore[t]||(e.IncludesShadersStore[t]=s);var h={name:t,shader:s};var r="logDepthVertex",a=`#ifdef LOGARITHMICDEPTH
vFragmentDepth=1.0+gl_Position.w;gl_Position.z=log2(max(0.000001,vFragmentDepth))*logarithmicDepthConstant;
#endif
`;e.IncludesShadersStore[r]||(e.IncludesShadersStore[r]=a);var l={name:r,shader:a};export{i as a,h as b,l as c};
