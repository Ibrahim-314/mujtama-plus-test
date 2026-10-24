import{a as R}from"./chunk-WQFL564G.js";import{a as P,b as _,c as S,d}from"./chunk-6536HNDG.js";import{a as n}from"./chunk-U7KJ2SW7.js";import{a as f,b as a}from"./chunk-GIIQXDZM.js";import{a as t}from"./chunk-NFNEHPMN.js";import{a as e}from"./chunk-4MOED6VN.js";import"./chunk-VC46IEJQ.js";var i="gaussianSplattingFragmentDeclaration",g=`vec4 gaussianColor(vec4 inColor)
{float A=-dot(vPosition,vPosition);if (A<-4.0) discard;float B=exp(A)*inColor.a;
#include<logDepthFragment>
vec3 color=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4(color,B);}
`;e.IncludesShadersStore[i]||(e.IncludesShadersStore[i]=g);var T={name:i,shader:g};var r="geometryRenderingFragment",m=`#ifdef PREPASS
#if SCENE_MRT_COUNT>0
float geometryCoverage=geometryColor.a>0.4 ? 1.0 : 0.0;
#ifdef PREPASS_COLOR
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_COLOR_INDEX,geometryColor);
#endif
#ifdef PREPASS_POSITION
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_POSITION_INDEX,vec4(geometryPositionW,geometryCoverage));
#endif
#ifdef PREPASS_LOCAL_POSITION
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_LOCAL_POSITION_INDEX,vec4(geometryPositionL,geometryCoverage));
#endif
#ifdef PREPASS_DEPTH
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_DEPTH_INDEX,vec4(geometryViewDepth,0.0,0.0,geometryCoverage));
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_NORMALIZED_VIEW_DEPTH_INDEX,vec4(geometryNormalizedViewDepth,0.0,0.0,geometryCoverage));
#endif
#ifdef PREPASS_SCREENSPACE_DEPTH
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_SCREENSPACE_DEPTH_INDEX,vec4(gl_FragCoord.z,0.0,0.0,geometryCoverage));
#endif
#ifdef PREPASS_NORMAL
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_NORMAL_INDEX,vec4(geometryNormalV,geometryCoverage));
#endif
#ifdef PREPASS_WORLD_NORMAL
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_WORLD_NORMAL_INDEX,vec4(geometryNormalW*0.5+0.5,geometryCoverage));
#endif
#ifdef PREPASS_ALBEDO
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_ALBEDO_INDEX,vec4(geometryAlbedo,geometryCoverage));
#endif
#ifdef PREPASS_ALBEDO_SQRT
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_ALBEDO_SQRT_INDEX,vec4(sqrt(max(geometryAlbedo,vec3(0.0))),geometryCoverage));
#endif
#ifdef PREPASS_REFLECTIVITY
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_REFLECTIVITY_INDEX,vec4(0.0,0.0,0.0,geometryCoverage));
#endif
#ifdef PREPASS_IRRADIANCE
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_IRRADIANCE_INDEX,vec4(0.0,0.0,0.0,geometryCoverage));
#endif
#ifdef PREPASS_IRRADIANCE_LEGACY
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_IRRADIANCE_LEGACY_INDEX,vec4(0.0));
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
#ifdef PREPASS_VELOCITY_ZERO
vec2 geometryMotion=vec2(0.0);
#else
vec2 geometryMotion=0.5*(geometryCurrentPosition.xy/geometryCurrentPosition.w-geometryPreviousPosition.xy/geometryPreviousPosition.w);
#endif
#ifdef PREPASS_VELOCITY
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_VELOCITY_INDEX,vec4(pow(abs(geometryMotion),vec2(1.0/3.0))*sign(geometryMotion)*0.5+0.5,0.0,geometryCoverage));
#endif
#ifdef PREPASS_VELOCITY_LINEAR
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_VELOCITY_LINEAR_INDEX,vec4(-geometryMotion,0.0,geometryCoverage));
#endif
#endif
#ifdef PREPASS_OBJECT_ID
WRITE_GEOMETRY_FRAGMENT_OUTPUT(PREPASS_OBJECT_ID_INDEX,encodeObjectId(objectId)*geometryCoverage);
#endif
#ifdef PREPASS_MESH_BLEND_TAG
meshBlendTagOutput=geometryCoverage>0.0 ? uvec4(uint(meshBlendTag),0u,0u,0u) : uvec4(0u);
#endif
#endif
#endif
`;e.IncludesShadersStore[r]||(e.IncludesShadersStore[r]=m);var A={name:r,shader:m};var E="gaussianSplattingPixelShader",l=`#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#define PREPASS_CUSTOM_VARYINGS
#include<prePassDeclaration>[SCENE_MRT_COUNT]
#if defined(GPUPICKER_DEPTH) && !defined(PREPASS)
layout(location=0) out highp vec4 glFragData[2];
#endif
#ifdef GPUPICKER_PACK_DEPTH
#include<packingFunctions>
#endif
varying vec4 vColor;varying vec2 vPosition;
#ifdef PREPASS
uniform float geometryZeroAlphaDiscard;
#ifdef PREPASS_POSITION
varying vec3 vGeometryPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
varying vec3 vGeometryPositionL;
#endif
#ifdef PREPASS_DEPTH
varying float vGeometryViewDepth;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
varying float vGeometryNormalizedViewDepth;
#endif
#ifdef PREPASS_NORMAL
varying vec3 vGeometryNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
varying vec3 vGeometryNormalW;
#endif
#if defined(PREPASS_ALBEDO) || defined(PREPASS_ALBEDO_SQRT)
varying vec3 vGeometryAlbedo;
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
varying vec4 vGeometryCurrentPosition;varying vec4 vGeometryPreviousPosition;
#endif
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
#include<gaussianSplattingFragmentDeclaration>
void main () {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
vec4 finalColor=gaussianColor(vColor);
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
#ifdef PREPASS
if (finalColor.a<=0.0 && geometryZeroAlphaDiscard>0.0) {discard;}
vec4 geometryColor=finalColor;
#if defined(PREPASS_ALBEDO) || defined(PREPASS_ALBEDO_SQRT)
vec3 geometryAlbedo=vGeometryAlbedo;
#endif
#ifdef PREPASS_POSITION
vec3 geometryPositionW=vGeometryPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
vec3 geometryPositionL=vGeometryPositionL;
#endif
#ifdef PREPASS_DEPTH
float geometryViewDepth=vGeometryViewDepth;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
float geometryNormalizedViewDepth=vGeometryNormalizedViewDepth;
#endif
#ifdef PREPASS_NORMAL
vec3 geometryNormalV=vGeometryNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
vec3 geometryNormalW=vGeometryNormalW;
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
vec4 geometryCurrentPosition=vGeometryCurrentPosition;vec4 geometryPreviousPosition=vGeometryPreviousPosition;
#endif
#include<geometryRenderingFragment>
#elif defined(GPUPICKER_DEPTH)
glFragData[0]=finalColor;
#ifdef GPUPICKER_PACK_DEPTH
glFragData[1]=pack(gl_FragCoord.z);
#else
glFragData[1]=vec4(gl_FragCoord.z,0.0,0.0,1.0);
#endif
#else
gl_FragColor=finalColor;
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStore[E]||(e.ShadersStore[E]=l);var O=[f,t,_,n,P,R,S,d,T,a,A];for(let o of O)e.IncludesShadersStore[o.name]||(e.IncludesShadersStore[o.name]=o.shader);var V={name:E,shader:l};export{V as gaussianSplattingPixelShader};
