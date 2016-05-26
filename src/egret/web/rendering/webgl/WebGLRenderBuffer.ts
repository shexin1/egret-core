//////////////////////////////////////////////////////////////////////////////////////
//
//  Copyright (c) 2014-2015, Egret Technology Inc.
//  All rights reserved.
//  Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the Egret nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.
//
//  THIS SOFTWARE IS PROVIDED BY EGRET AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
//  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
//  OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
//  IN NO EVENT SHALL EGRET AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
//  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;LOSS OF USE, DATA,
//  OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
//  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
//  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
//  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
//////////////////////////////////////////////////////////////////////////////////////

module egret.web {

    /**
     * draw类型，所有的绘图操作都会缓存在drawData中，每个drawData都是一个drawable对象
     * $renderWebGL方法依据drawable对象的类型，调用不同的绘制方法
     * TODO 提供drawable类型接口并且创建对象池？
     */
     export const enum DRAWABLE_TYPE {
         TEXTURE,
         RECT,
         PUSH_MASK,
         POP_MASK,
         BLEND
     }

    /**
     * 创建一个canvas。
     */
    function createCanvas(width?:number, height?:number):HTMLCanvasElement {
        var canvas:HTMLCanvasElement = document.createElement("canvas");
        if (!isNaN(width) && !isNaN(height)) {
            canvas.width = width;
            canvas.height = height;
        }
        $toBitmapData(canvas);
        return canvas;
    }

    /**
     * @private
     * WebGL渲染器
     */
    export class WebGLRenderBuffer implements sys.RenderBuffer {

        /**
         * 渲染上下文
         */
        public context:WebGLRenderContext;

        /**
         * 是否为舞台buffer
         */
        private root:boolean;

        public constructor(width?:number, height?:number) {
            // 获取webglRenderContext
            this.context = WebGLRenderContext.getInstance(width, height);
            // buffer 对应的 render target
            this.rootRenderTarget = new WebGLRenderTarget(this.context.context, width, height);

            // TODO 抽像WebGLState类用于管理webgl状态，包括stencil，blend，colorMask等等
            this.stencilState = false;

            this.initVertexArrayObjects();

            this.setGlobalCompositeOperation("source-over");

            // 如果是第一个加入的buffer，说明是舞台buffer
            this.root = this.context.$bufferStack.length == 0;

            // 如果是用于舞台渲染的renderBuffer，则默认添加renderTarget到renderContext中，而且是第一个
            if(this.root) {
                this.context.pushBuffer(this);
                // 画布
                this.surface = this.context.surface;
            } else {
                // 由于创建renderTarget造成的frameBuffer绑定，这里重置绑定
                var lastBuffer = this.context.currentBuffer;
                if(lastBuffer) {
                    lastBuffer.rootRenderTarget.activate();
                }

                this.surface = this.rootRenderTarget;
            }
        }

        private filters = [];
        public pushFilters(filters) {
            this.filters.push(filters);
        }
        public popFilters() {
            this.filters.pop();
        }
        public clearFilters() {
            this.filters.length = 0;
        }
        public getFilters() {
            var filters = [];
            for(var i = 0; i < this.filters.length; i++) {
                var _filters = this.filters[i];
                if(_filters) {
                    for(var j = 0; j < _filters.length; j++) {
                        var filter = _filters[j];
                        if(filter && filter.type != "glow") {// 暂时屏蔽掉发光滤镜
                            filters.push(filter);
                        }
                    }
                }
            }
            return filters;
        }

        /**
         * 如果是舞台缓存，为canvas
         * 如果是普通缓存，为renderTarget
         */
        public surface:any;

        /**
         * root render target
         * 根渲染目标，用来执行主渲染
         */
        public rootRenderTarget:WebGLRenderTarget;

        /**
         * 初始化顶点数组和缓存
         */
        private size:number = 2000;
        private vertexMaxSize:number = 2000 * 4;
        public vertices:Float32Array = null;
        private vertSize:number = 5;
        public indices:Uint16Array = null;
        private indicesForMesh:Uint16Array = null;
        public initVertexArrayObjects() {
            var numVerts = this.vertexMaxSize * this.vertSize;
            var numIndices = this.vertexMaxSize * 3 / 2;

            this.vertices = new Float32Array(numVerts);
            this.indices = new Uint16Array(numIndices);
            this.indicesForMesh = new Uint16Array(numIndices);

            for (var i = 0, j = 0; i < numIndices; i += 6, j += 4) {
                this.indices[i + 0] = j + 0;
                this.indices[i + 1] = j + 1;
                this.indices[i + 2] = j + 2;
                this.indices[i + 3] = j + 0;
                this.indices[i + 4] = j + 2;
                this.indices[i + 5] = j + 3;
            }
        }

        /**
         * stencil state
         * 模版开关状态
         */
        private stencilState:boolean;

        public $stencilList = [];
        public stencilHandleCount:number = 0;

        public enableStencil():void {
            if(!this.stencilState) {
                this.context.enableStencilTest();
                this.stencilState = true;
            }
        }

        public disableStencil():void {
            if(this.stencilState) {
                this.context.disableStencilTest();
                this.stencilState = false;
            }
        }

        public restoreStencil():void {
            if(this.stencilState) {
                this.context.enableStencilTest();
            } else {
                this.context.disableStencilTest();
            }
        }

        /**
         * 渲染缓冲的宽度，以像素为单位。
         * @readOnly
         */
        public get width():number {
            return this.rootRenderTarget.width;
        }

        /**
         * 渲染缓冲的高度，以像素为单位。
         * @readOnly
         */
        public get height():number {
            return this.rootRenderTarget.height;
        }

        /**
         * @private
         **/
        public $getWidth():number {
            return this.rootRenderTarget.width;
        }

        /**
         * @private
         **/
        public $getHeight():number {
            return this.rootRenderTarget.height;
        }

        /**
         * 改变渲染缓冲的大小并清空缓冲区
         * @param width 改变后的宽
         * @param height 改变后的高
         * @param useMaxSize 若传入true，则将改变后的尺寸与已有尺寸对比，保留较大的尺寸。
         */
        public resize(width:number, height:number, useMaxSize?:boolean):void {

            width = width || 1;
            height = height || 1;

            // render target 尺寸重置
            if(width != this.rootRenderTarget.width || height != this.rootRenderTarget.height) {
                this.rootRenderTarget.resize(width, height);
            }

            // 如果是舞台的渲染缓冲，执行resize，否则surface大小不随之改变
            if(this.root) {
                this.context.resize(width, height, useMaxSize);
            }

            this.rootRenderTarget.clear(true);

            // 由于resize与clear造成的frameBuffer绑定，这里重置绑定
            var lastBuffer = this.context.currentBuffer;
            if(lastBuffer) {
                lastBuffer.rootRenderTarget.activate();
            }
        }



        /**
         * 改变渲染缓冲为指定大小，但保留原始图像数据
         * @param width 改变后的宽
         * @param height 改变后的高
         * @param offsetX 原始图像数据在改变后缓冲区的绘制起始位置x
         * @param offsetY 原始图像数据在改变后缓冲区的绘制起始位置y
         */
        public resizeTo(width:number, height:number, offsetX:number, offsetY:number):void {
            // TODO 这里用于cacheAsBitmap的实现

            // var oldSurface = this.surface;
            // var oldWidth = oldSurface.width;
            // var oldHeight = oldSurface.height;
            // this.context.resizeTo(width, height, offsetX, offsetY);
            // renderTexture resize, copy color data
            // this.drawFrameBufferToSurface(0, 0, oldWidth, oldHeight, offsetX, offsetY, oldWidth, oldHeight, true);

        }

        // dirtyRegionPolicy hack
        private dirtyRegionPolicy:boolean = true;
        private _dirtyRegionPolicy:boolean = true;// 默认设置为true，保证第一帧绘制在frameBuffer上
        public setDirtyRegionPolicy(state:string):void {
            this.dirtyRegionPolicy = (state == "on");
        }

        /**
         * 清空并设置裁切
         * @param regions 矩形列表
         * @param offsetX 矩形要加上的偏移量x
         * @param offsetY 矩形要加上的偏移量y
         */
        public beginClip(regions:sys.Region[], offsetX?:number, offsetY?:number):void {

            // dirtyRegionPolicy hack
            if(this._dirtyRegionPolicy) {
                this.rootRenderTarget.useFrameBuffer = true;
                this.rootRenderTarget.activate();
            } else {
                this.rootRenderTarget.useFrameBuffer = false;
                this.rootRenderTarget.activate();
                this.clear();
            }

            offsetX = +offsetX || 0;
            offsetY = +offsetY || 0;
            this.setTransform(1, 0, 0, 1, offsetX, offsetY);
            var length = regions.length;
            //只有一个区域且刚好为舞台大小时,不设置模板
            if (length == 1 && regions[0].minX == 0 && regions[0].minY == 0 &&
                regions[0].width == this.rootRenderTarget.width && regions[0].height == this.rootRenderTarget.height) {
                this.maskPushed = false;
                this.rootRenderTarget.useFrameBuffer && this.clear();
                return;
            }
            // 擦除脏矩形区域
            for (var i = 0; i < length; i++) {
                var region = regions[i];
                this.clearRect(region.minX, region.minY, region.width, region.height);
            }
            // 设置模版
            if (length > 0) {
                this.pushMask(regions);
                this.maskPushed = true;
                this.offsetX = offsetX;
                this.offsetY = offsetY;
            }
            else {
                this.maskPushed = false;
            }
        }

        private maskPushed:boolean;
        private offsetX:number;
        private offsetY:number;

        /**
         * 取消上一次设置的clip。
         */
        public endClip():void {
            if (this.maskPushed) {
                this.setTransform(1, 0, 0, 1, this.offsetX, this.offsetY);
                this.popMask();
            }
        }

        /**
         * 获取指定坐标的像素
         */
        public getPixel(x:number, y:number):number[] {
            var pixels = new Uint8Array(4);

            var useFrameBuffer = this.rootRenderTarget.useFrameBuffer;
            this.rootRenderTarget.useFrameBuffer = true;
            this.rootRenderTarget.activate();

            this.context.getPixels(x, y, 1, 1, pixels);

            this.rootRenderTarget.useFrameBuffer = useFrameBuffer;
            this.rootRenderTarget.activate();

            return <number[]><any>pixels;
        }

        /**
         * 转换成base64字符串，如果图片（或者包含的图片）跨域，则返回null
         * @param type 转换的类型，如: "image/png","image/jpeg"
         */
        public toDataURL(type?:string, encoderOptions?:number):string {
            return this.context.surface.toDataURL(type, encoderOptions);
        }

        /**
         * 销毁绘制对象
         */
        public destroy():void {
            this.context.destroy();
        }

        public onRenderFinish():void {
            this.$drawCalls = 0;

            // 如果是舞台渲染buffer，判断脏矩形策略
            if(this.root) {
                // dirtyRegionPolicy hack
                if(!this._dirtyRegionPolicy && this.dirtyRegionPolicy) {
                    this.drawSurfaceToFrameBuffer(0, 0, this.rootRenderTarget.width, this.rootRenderTarget.height, 0, 0, this.rootRenderTarget.width, this.rootRenderTarget.height, true);
                }
                if(this._dirtyRegionPolicy) {
                    this.drawFrameBufferToSurface(0, 0, this.rootRenderTarget.width, this.rootRenderTarget.height, 0, 0, this.rootRenderTarget.width, this.rootRenderTarget.height);
                }
                this._dirtyRegionPolicy = this.dirtyRegionPolicy;
            }
        }

        /**
         * 交换frameBuffer中的图像到surface中
         * @param width 宽度
         * @param height 高度
         */
        private drawFrameBufferToSurface(sourceX:number,
          sourceY:number, sourceWidth:number, sourceHeight:number, destX:number, destY:number, destWidth:number, destHeight:number, clear:boolean = false):void {
            this.rootRenderTarget.useFrameBuffer = false;
            this.rootRenderTarget.activate();

            this.context.disableStencilTest();// 切换frameBuffer注意要禁用STENCIL_TEST

            this.setTransform(1, 0, 0, 1, 0, 0);
            this.setGlobalAlpha(1);
            this.setGlobalCompositeOperation("source-over");
            clear && this.clear();
            this.drawImage(<BitmapData><any>this.rootRenderTarget, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight, sourceWidth, sourceHeight);
            this.$drawWebGL();

            this.rootRenderTarget.useFrameBuffer = true;
            this.rootRenderTarget.activate();

            this.restoreStencil();
        }
        /**
         * 交换surface的图像到frameBuffer中
         * @param width 宽度
         * @param height 高度
         */
        private drawSurfaceToFrameBuffer(sourceX:number,
          sourceY:number, sourceWidth:number, sourceHeight:number, destX:number, destY:number, destWidth:number, destHeight:number, clear:boolean = false):void {
            this.rootRenderTarget.useFrameBuffer = true;
            this.rootRenderTarget.activate();

            this.context.disableStencilTest();// 切换frameBuffer注意要禁用STENCIL_TEST

            this.setTransform(1, 0, 0, 1, 0, 0);
            this.setGlobalAlpha(1);
            this.setGlobalCompositeOperation("source-over");
            clear && this.clear();
            this.drawImage(<BitmapData><any>this.context.surface, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight, sourceWidth, sourceHeight);
            this.$drawWebGL();

            this.rootRenderTarget.useFrameBuffer = false;
            this.rootRenderTarget.activate();

            this.restoreStencil();
        }

        /**
         * 清空缓冲区数据
         */
        public clear():void {
            if(this.rootRenderTarget.width != 0 && this.rootRenderTarget.height != 0) {
                this.context.clear();
            }
        }

        /**
         * @private
         */
        public clearRect(x:number, y:number, width:number, height:number):void {
            this.setGlobalCompositeOperation("destination-out");
            this.drawRect(x, y, width, height);
            this.setGlobalCompositeOperation("source-over");
        }

        //Rendering Functions begin
        public drawImage(texture:BitmapData,
                         sourceX:number, sourceY:number, sourceWidth:number, sourceHeight:number,
                         destX:number, destY:number, destWidth:number, destHeight:number,
                         textureSourceWidth:number, textureSourceHeight:number):void {
            if (this.context.contextLost) {
                return;
            }
            if (!texture) {
                return;
            }

            var webGLTexture:WebGLTexture;
            if(texture["texture"]) {
                // 如果是render target
                webGLTexture = texture["texture"];
                this.saveTransform();
                this.transform(1, 0, 0, -1, 0, destHeight + destY * 2);// 翻转
            } else {
                webGLTexture = this.context.getWebGLTexture(texture);
            }

            if (!webGLTexture) {
                return;
            }
            this.drawTexture(webGLTexture,
                sourceX, sourceY, sourceWidth, sourceHeight,
                destX, destY, destWidth, destHeight,
                textureSourceWidth, textureSourceHeight);
            if(texture["texture"]) {
                this.restoreTransform();
            }
        }

        private hasMesh: boolean = false;
        private prevIsMesh: boolean = false;
        private vertexIndex: number = 0;
        private indexIndex: number = 0;

        public drawMesh(texture:BitmapData,
                         sourceX:number, sourceY:number, sourceWidth:number, sourceHeight:number,
                         destX:number, destY:number, destWidth:number, destHeight:number,
                         textureSourceWidth:number, textureSourceHeight:number,
                         meshUVs:number[], meshVertices:number[], meshIndices:number[], bounds:Rectangle
                         ):void {
            if (this.context.contextLost) {
                return;
            }
            if (!texture) {
                return;
            }

            var webGLTexture = this.context.getWebGLTexture(texture);
            if (!webGLTexture) {
                return;
            }

            this.drawTexture(webGLTexture,
                sourceX, sourceY, sourceWidth, sourceHeight,
                destX, destY, destWidth, destHeight,
                textureSourceWidth, textureSourceHeight, meshUVs, meshVertices, meshIndices, bounds);

        }

        /**
         * @private
         * draw a texture use default shader
         * */
        public drawTexture(texture:WebGLTexture,
                            sourceX:number, sourceY:number, sourceWidth:number, sourceHeight:number,
                            destX:number, destY:number, destWidth:number, destHeight:number, textureWidth:number, textureHeight:number,
                            meshUVs?:number[], meshVertices?:number[], meshIndices?:number[], bounds?:Rectangle):void {
            if (this.context.contextLost) {
                return;
            }
            if (!texture) {
                return;
            }
            var webGLTexture = <Texture>texture;

            if (this.vertexIndex >= this.vertexMaxSize - 1) {
                this.$drawWebGL();
            }

            var filters = this.getFilters();
            if(filters.length > 0) {
                var width = destWidth;
                var height = destHeight;
                var offsetX = 0;
                var offsetY = 0;
                if(bounds) {
                    width = bounds.width;
                    height = bounds.height;
                    offsetX = -bounds.x;
                    offsetY = -bounds.y;
                }
                this.drawTextureWidthFilter(filters, webGLTexture,
                    sourceX, sourceY, sourceWidth, sourceHeight,
                    destX, destY, destWidth, destHeight, textureWidth, textureHeight,
                    width, height, offsetX, offsetY, meshUVs, meshVertices, meshIndices);// 后参数用于draw mesh
            } else {
                // this.filter = null;

                var count = meshIndices ? meshIndices.length / 3 : 2;
                if (this.drawData.length > 0 && this.drawData[this.drawData.length - 1].type == DRAWABLE_TYPE.TEXTURE && webGLTexture == this.drawData[this.drawData.length - 1].texture && (this.prevIsMesh == !!meshUVs) && !this.drawData[this.drawData.length - 1].filter) {
                    this.drawData[this.drawData.length - 1].count += count;
                } else {
                    this.drawData.push({type: DRAWABLE_TYPE.TEXTURE, texture: webGLTexture, count: count});
                }

                this.cacheArrays(sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight, textureWidth, textureHeight,
                    meshUVs, meshVertices, meshIndices);
            }

            if(meshUVs) {
                this.hasMesh = true;
                this.prevIsMesh = true;
            } else {
                this.prevIsMesh = false;
            }

        }

        /**
         * 绘制材质并应用滤镜
         * 这里为drawMesh新增四个参数：realWidth, realHeight, offsetX, offsetY
         * realWidth与realHeight为实际mesh宽高
         * offsetX与offsetY为绘制mesh时的偏移量，向左为正值
         */
        private drawTextureWidthFilter(filters:any, webGLTexture:WebGLTexture,
                            sourceX:number, sourceY:number, sourceWidth:number, sourceHeight:number,
                            destX:number, destY:number, destWidth:number, destHeight:number, textureWidth:number, textureHeight:number,
                            realWidth:number, realHeight:number, _offsetX:number, _offsetY:number,
                            meshUVs?:number[], meshVertices?:number[], meshIndices?:number[]) {

            var len = filters.length;

            // destWidth = realWidth;
            // destHeight = realHeight;
            // var gOffsetX = _offsetX;
            // var gOffsetY = _offsetY;
            var gOffsetX = 0;
            var gOffsetY = 0;

            // 递归执行滤镜
            var input = null;
            var output = null;
            if(len > 1) {
                // TODO 可省略
                input = this.createRenderBuffer(realWidth, realHeight);
                gOffsetX += _offsetX;
                gOffsetY += _offsetY;
                this.drawToRenderTarget(null, webGLTexture, input, sourceX, sourceY, sourceWidth, sourceHeight, _offsetX, _offsetY, destWidth, destHeight, textureWidth, textureHeight, true,
                    meshUVs, meshVertices, meshIndices);

                for(var i = 0; i < len - 1; i++) {
                    var filter = filters[i];
                    // 要为模糊发光等改变尺寸的滤镜创建一个大一些的画布
                    var offsetX = 0;
                    var offsetY = 0;
                    var distanceX:number = 0;
                    var distanceY:number = 0;
                    if(filter.type == "blur") {
                        offsetX = filter.blurX * 0.028 * input.$getWidth();
                        offsetY = filter.blurY * 0.028 * input.$getHeight();
                    }
                    if(filter.type == "glow") {
                        offsetX = filter.blurX * 0.028 * input.$getWidth();
                        offsetY = filter.blurY * 0.028 * input.$getHeight();
                        // 计算glow滤镜需要的尺寸还需要加上偏移量，此处把glow放置在滤镜队列前面会造成影子被剪切
                        var distance:number = filter.distance || 0;
                        var angle:number = filter.angle || 0;
                        if (distance != 0 && angle != 0) {
                            distanceX = Math.ceil(distance * egret.NumberUtils.cos(angle));
                            distanceY = Math.ceil(distance * egret.NumberUtils.sin(angle));
                        }
                        offsetX += Math.abs(distanceX);
                        offsetY += Math.abs(distanceY);
                    }
                    output = this.createRenderBuffer(input.$getWidth() + offsetX * 2, input.$getHeight() + offsetY * 2);
                    this.drawToRenderTarget(filter, input, output, 0, 0, input.$getWidth(), input.$getHeight(), (output.$getWidth() - input.$getWidth()) / 2, (output.$getHeight() - input.$getHeight()) / 2, input.$getWidth(), input.$getHeight(), input.$getWidth(), input.$getHeight());
                    input = output;

                    gOffsetX += offsetX;
                    gOffsetY += offsetY;
                }
            }

            // 应用最后的滤镜
            var filter = filters[len - 1];

            // 实现为blurX与blurY的叠加
            if (filter.type == "blur" && filter.blurX != 0 && filter.blurY != 0) {
                if (!this.blurFilter) {
                    this.blurFilter = new egret.BlurFilter(2, 2);
                }
                this.blurFilter.blurX = filter.blurX;
                this.blurFilter.blurY = 0;
                var offsetX = 0;
                var offsetY = 0;
                if(output) {
                    input = output;
                    offsetX = this.blurFilter.blurX * 0.028 * input.$getWidth();
                    offsetY = this.blurFilter.blurY * 0.028 * input.$getHeight();
                    output = this.createRenderBuffer(input.$getWidth() + offsetX * 2, input.$getHeight() + offsetY * 2);
                    this.drawToRenderTarget(this.blurFilter, input, output, 0, 0, input.$getWidth(), input.$getHeight(), (output.$getWidth() - input.$getWidth()) / 2, (output.$getHeight() - input.$getHeight()) / 2, input.$getWidth(), input.$getHeight(), input.$getWidth(), input.$getHeight());
                } else {
                    offsetX = this.blurFilter.blurX * 0.028 * realWidth;
                    offsetY = this.blurFilter.blurY * 0.028 * realHeight;
                    gOffsetX += _offsetX;
                    gOffsetY += _offsetY;
                    output = this.createRenderBuffer(realWidth + offsetX * 2, realHeight + offsetY * 2);
                    this.drawToRenderTarget(this.blurFilter, webGLTexture, output, sourceX, sourceY, sourceWidth, sourceHeight, offsetX + _offsetX, offsetY + _offsetY, destWidth, destHeight, textureWidth, textureHeight, true, meshUVs, meshVertices, meshIndices);
                }
                gOffsetX += offsetX;
                gOffsetY += offsetY;
            }

            // 如果是发光滤镜，绘制光晕
            if(filter.type == "glow") {
                if(!output) {
                    gOffsetX += _offsetX;
                    gOffsetY += _offsetY;
                    output = this.createRenderBuffer(realWidth, realHeight);
                    this.drawToRenderTarget(null, webGLTexture, output, sourceX, sourceY, sourceWidth, sourceHeight, _offsetX, _offsetY, destWidth, destHeight, textureWidth, textureHeight, true, meshUVs, meshVertices, meshIndices);
                }
                // 会调用$drawWebGL
                this.drawGlow(filter, output, destX - gOffsetX, destY - gOffsetY);
            }

            // 绘制output结果到舞台
            var offsetX = 0;
            var offsetY = 0;
            if(output) {
                if (filter.type == "blur"){
                    if (!this.blurFilter) {
                        this.blurFilter = new egret.BlurFilter(2, 2);
                    }
                    if(filter.blurX == 0 || filter.blurY == 0) {
                        this.blurFilter.blurX = filter.blurX;
                        this.blurFilter.blurY = filter.blurY;
                    } else {
                        this.blurFilter.blurX = 0;
                        this.blurFilter.blurY = filter.blurY;
                    }
                    filter = this.blurFilter;

                    offsetX = this.blurFilter.blurX * 0.028 * output.$getWidth();
                    offsetY = this.blurFilter.blurY * 0.028 * output.$getHeight();
                }
                this.saveTransform();
                this.transform(1, 0, 0, -1, 0, output.$getHeight() + 2 * offsetY + (destY - offsetY - gOffsetY) * 2);
                this.cacheArrays(-offsetX, -offsetY, output.$getWidth() + 2 * offsetX, output.$getHeight() + 2 * offsetY, destX - offsetX - gOffsetX, destY - offsetY - gOffsetY, output.$getWidth() + 2 * offsetX, output.$getHeight() + 2 * offsetY, output.$getWidth(), output.$getHeight());
                this.restoreTransform();
                this.drawData.push({type: DRAWABLE_TYPE.TEXTURE, texture: output["rootRenderTarget"].texture, filter: filter, count: 2});
            } else {
                if (filter.type == "blur") {
                    offsetX = filter.blurX * 0.028 * realWidth;
                    offsetY = filter.blurY * 0.028 * realHeight;
                }
                this.cacheArrays(sourceX - offsetX, sourceY - offsetY, sourceWidth + 2 * offsetX, sourceHeight + 2 * offsetY, destX - offsetX - gOffsetX, destY - offsetY - gOffsetY, destWidth + 2 * offsetX, destHeight + 2 * offsetY, textureWidth, textureHeight, meshUVs, meshVertices, meshIndices);
                var uv = this.getUv(sourceX, sourceY, sourceWidth, sourceHeight, textureWidth, textureHeight);
                this.drawData.push({type: DRAWABLE_TYPE.TEXTURE, texture: webGLTexture, filter: filter, count: meshIndices ? meshIndices.length / 3 : 2, uv: uv});
            }

            if(output) {
                // 确保完全绘制完成后才能释放output
                this.$drawWebGL();

                output.clearFilters();
                output.filter = null;
                renderBufferPool.push(output);
            }
        }

        /**
         * 向一个renderTarget中绘制
         * */
        private drawToRenderTarget(filter:Filter, input:any, output:WebGLRenderBuffer,
                            sourceX:number, sourceY:number, sourceWidth:number, sourceHeight:number,
                            destX:number, destY:number, destWidth:number, destHeight:number, textureWidth:number, textureHeight:number, release:boolean = true,
                            meshUVs?:number[], meshVertices?:number[], meshIndices?:number[]) {
            this.context.pushBuffer(output);
            output.setGlobalAlpha(1);
            output.setTransform(1, 0, 0, 1, 0, 0);
            if(filter) {
                output.pushFilters([filter]);
            }
            if(input["rootRenderTarget"]) {
                output.drawImage(<BitmapData><any>input.rootRenderTarget, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight, textureWidth, textureHeight);
            } else {
                output.drawTexture(<WebGLTexture><any>input, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight, textureWidth, textureHeight, meshUVs, meshVertices, meshIndices);
            }
            if(filter) {
                output.popFilters();
            }
            output.$drawWebGL();
            this.context.popBuffer();
            if(input["rootRenderTarget"] && release) { // 如果输入的是buffer,回收
                input.clearFilters();
                input.filter = null;
                renderBufferPool.push(input);
            }
        }

        private colorMatrixFilter = null;
        private blurFilter = null;
        private drawGlow(filter, input:WebGLRenderBuffer, destX, destY) {
            if(!this.colorMatrixFilter) {
                this.colorMatrixFilter = new ColorMatrixFilter();
            }
            if(!this.blurFilter) {
                this.blurFilter = new BlurFilter(2, 2);
            }

            var output = null;
            var offsetX = 0;
            var offsetY = 0;
            var distance:number = filter.distance || 0;
            var angle:number = filter.angle || 0;
            var distanceX:number = 0;
            var distanceY:number = 0;
            if (distance != 0 && angle != 0) {
                distanceX = Math.ceil(distance * egret.NumberUtils.cos(angle));
                distanceY = Math.ceil(distance * egret.NumberUtils.sin(angle));
            }

            //绘制纯色图
            this.colorMatrixFilter.matrix = [
                0, 0, 0, 0, filter.$red,
                0, 0, 0, 0, filter.$green,
                0, 0, 0, 0, filter.$blue,
                0, 0, 0, 0, filter.alpha,
            ];
            output = this.createRenderBuffer(input.$getWidth(), input.$getHeight());
            this.drawToRenderTarget(this.colorMatrixFilter, input, output, 0, 0, input.$getWidth(), input.$getHeight(), 0, 0, output.$getWidth(), output.$getHeight(), input.$getWidth(), input.$getHeight(), false);
            draw.call(this, output, distanceX - offsetX, distanceY - offsetY);
            this.$drawWebGL();

            // 应用blurX
            this.blurFilter.blurX = filter.blurX;
            this.blurFilter.blurY = 0;
            input = output;
            offsetX += filter.blurX * 0.028 * input.$getWidth();
            output = this.createRenderBuffer(input.$getWidth() + offsetX * 2, input.$getHeight());
            this.drawToRenderTarget(this.blurFilter, input, output, 0, 0, input.$getWidth(), input.$getHeight(), offsetX, 0, input.$getWidth(), input.$getHeight(), input.$getWidth(), input.$getHeight());
            draw.call(this, output, distanceX - offsetX, distanceY - offsetY);
            this.$drawWebGL();

            // 应用blurY
            this.blurFilter.blurX = 0;
            this.blurFilter.blurY = filter.blurY;
            input = output;
            offsetY += filter.blurY * 0.028 * input.$getHeight();
            output = this.createRenderBuffer(input.$getWidth(), input.$getHeight() + offsetY * 2);
            this.drawToRenderTarget(this.blurFilter, input, output, 0, 0, input.$getWidth(), input.$getHeight(), 0, offsetY, input.$getWidth(), input.$getHeight(), input.$getWidth(), input.$getHeight());
            draw.call(this, output, distanceX - offsetX, distanceY - offsetY);
            this.$drawWebGL();

            // 根据光强绘制光
            this.setGlobalCompositeOperation("lighter-in");
            for(var j = 0; j < filter.quality; j++) {
                draw.call(this, output, distanceX - offsetX, distanceY - offsetY);
            }
            this.setGlobalCompositeOperation("source-over");
            this.$drawWebGL();

            function draw(result, offsetX, offsetY) {
                this.saveTransform();
                this.transform(1, 0, 0, -1, 0, result.$getHeight() + (destY + offsetY) * 2);
                this.cacheArrays(0, 0, result.$getWidth(), result.$getHeight(), destX + offsetX, destY + offsetY, result.$getWidth(), result.$getHeight(), result.$getWidth(), result.$getHeight());
                this.restoreTransform();
                this.drawData.push({type: DRAWABLE_TYPE.TEXTURE, texture: result.rootRenderTarget.texture, count: 0});
                // this.currentBatchSize++;
                // this.drawData[this.drawData.length - 1].count++;
                this.drawData[this.drawData.length - 1].count += 2;
            }

            output.clearFilters();
            output.filter = null;
            renderBufferPool.push(output);
        }

        /**
         * @private
         * draw a rect use default shader
         * */
        private drawRect(x:number, y:number, width:number, height:number):void {
            if (this.context.contextLost) {
                return;
            }

            // TODO if needed, this rect can set a color
            // if (this.currentBatchSize >= this.size - 1) {
            if (this.vertexIndex >= this.vertexMaxSize - 1) {
                this.$drawWebGL();
                this.drawData.push({type: DRAWABLE_TYPE.RECT, count: 0});
            } else if(this.drawData.length > 0 && this.drawData[this.drawData.length - 1].type == DRAWABLE_TYPE.RECT) {
                // merge to one draw
            } else {
                this.drawData.push({type: DRAWABLE_TYPE.RECT, count: 0});
            }

            this.cacheArrays(0, 0, width, height, x, y, width, height, width, height);

            // this.currentBatchSize++;
            // this.drawData[this.drawData.length - 1].count++;
            this.drawData[this.drawData.length - 1].count += 2;
        }

        /**
         * 缓存顶点与索引信息
         * 如果后三个参数缺省，默认为构成矩形的顶点
         * */
        private defaultMeshVertices = [0, 0, 1, 0, 1, 1, 0, 1];
        private defaultMeshUvs = [
            0, 0,
            1, 0,
            1, 1,
            0, 1
        ];
        private defaultMeshIndices = [0, 1, 2, 0, 2, 3];
        private cacheArrays(sourceX:number, sourceY:number, sourceWidth:number, sourceHeight:number,
                                destX:number, destY:number, destWidth:number, destHeight:number, textureSourceWidth:number, textureSourceHeight:number,
                                meshUVs?:number[], meshVertices?:number[], meshIndices?:number[]):void {

            // 如果后三个值缺省，默认为构成矩形的顶点
            if(!meshVertices) {
                this.defaultMeshVertices[2] = this.defaultMeshVertices[4] = sourceWidth;
                this.defaultMeshVertices[5] = this.defaultMeshVertices[7] = sourceHeight;
            }

            meshVertices = meshVertices || this.defaultMeshVertices;
            meshUVs = meshUVs || this.defaultMeshUvs;
            meshIndices = meshIndices || this.defaultMeshIndices;
            //计算出绘制矩阵，之后把矩阵还原回之前的
            var locWorldTransform = this.globalMatrix;
            var originalA:number = locWorldTransform.a;
            var originalB:number = locWorldTransform.b;
            var originalC:number = locWorldTransform.c;
            var originalD:number = locWorldTransform.d;
            var originalTx:number = locWorldTransform.tx;
            var originalTy:number = locWorldTransform.ty;
            if (destX != 0 || destY != 0) {
                locWorldTransform.append(1, 0, 0, 1, destX, destY);
            }
            if (sourceWidth / destWidth != 1 || sourceHeight / destHeight != 1) {
                locWorldTransform.append(destWidth / sourceWidth, 0, 0, destHeight / sourceHeight, 0, 0);
            }
            var a:number = locWorldTransform.a;
            var b:number = locWorldTransform.b;
            var c:number = locWorldTransform.c;
            var d:number = locWorldTransform.d;
            var tx:number = locWorldTransform.tx;
            var ty:number = locWorldTransform.ty;

            locWorldTransform.a = originalA;
            locWorldTransform.b = originalB;
            locWorldTransform.c = originalC;
            locWorldTransform.d = originalD;
            locWorldTransform.tx = originalTx;
            locWorldTransform.ty = originalTy;

            var vertices:Float32Array = this.vertices;
            var index:number = this.vertexIndex * this.vertSize;
            var alpha:number = this._globalAlpha;

            // 缓存顶点数组
            var i = 0, iD = 0, l = 0;
            var u = 0, v = 0, x = 0, y = 0;
            for (i = 0, l = meshUVs.length; i < l; i += 2) {
                iD = i * 5 / 2;
                x = meshVertices[i];
                y = meshVertices[i + 1];
                u = meshUVs[i];
                v = meshUVs[i + 1];

                // xy
                vertices[index + iD + 0] = a * x + c * y + tx;
                vertices[index + iD + 1] = b * x + d * y + ty;
                // uv
                vertices[index + iD + 2] = (sourceX + u * sourceWidth) / textureSourceWidth;
                vertices[index + iD + 3] = (sourceY + v * sourceHeight) / textureSourceHeight;
                // alpha
                vertices[index + iD + 4] = alpha;
            }

            // 缓存索引数组
            for (i = 0, l = meshIndices.length; i < l; ++i) {
                this.indicesForMesh[this.indexIndex + i] = meshIndices[i] + this.vertexIndex;
            }

            this.vertexIndex += meshUVs.length / 2;
            this.indexIndex += meshIndices.length;
        }

        private getUv(sourceX, sourceY, sourceWidth, sourceHeight, textureSourceWidth, textureSourceHeight) {
            var uv = [
                0, 0,
                1, 1
            ];
            for (var i = 0, l = uv.length; i < l; i += 2) {
                var u = uv[i];
                var v = uv[i + 1];
                // uv
                uv[i] = (sourceX + u * sourceWidth) / textureSourceWidth;
                uv[i + 1] = (sourceY + v * sourceHeight) / textureSourceHeight;
            }
            return uv;
        }

        private drawData = [];
        public $drawCalls:number = 0;
        public $computeDrawCall:boolean = false;

        public $drawWebGL():void {
            if (this.drawData.length == 0 || this.context.contextLost) {
                return;
            }

            // 上传顶点数组
            // if(this.vertexIndex > 0) {
                var view = this.vertices.subarray(0, this.vertexIndex * this.vertSize);
                this.context.uploadVerticesArray(view);
            // }

            // 有mesh，则使用indicesForMesh
            if (this.hasMesh){
                this.context.uploadIndicesArray(this.indicesForMesh);
            }

            var length = this.drawData.length;
            var offset = 0;
            // this.shaderStarted = false;
            for (var i = 0; i < length; i++) {
                var data = this.drawData[i];

                // this.prepareShader(data);

                offset = this.context.drawData(data, offset);

                // 计算draw call
                if(data.type != DRAWABLE_TYPE.BLEND) {
                    if (this.$computeDrawCall) {
                        this.$drawCalls++;
                    }
                }
            }

            // 切换回默认indices
            if(this.hasMesh) {
                this.context.uploadIndicesArray(this.indices);
            }

            // 清空数据
            this.hasMesh = false;
            this.drawData.length = 0;
            this.vertexIndex = 0;
            this.indexIndex = 0;
            // this.filter = null;
        }

        // private filter; //仅方法内使用
        // private shaderStarted:boolean;
        // private uv; //仅方法内使用
        // private drawingTexture:boolean;// 仅方法内使用


        // private prepareShader(data:any):void {
        //     // var drawingTexture = (data.type == DRAWABLE_TYPE.TEXTURE);
        //     // 根据filter开启shader
        //     // if(data.filter) {
        //         // var filter = data.filter;
        //
        //         // 如果是blur，需要判断是否重新上传uv坐标
        //         // if(filter.type == "blur") {
        //         //     var uvDirty = false;
        //         //     if(data.uv) {
        //         //         if(this.uv) {
        //         //             if(this.uv[0] != data.uv[0] || this.uv[1] != data.uv[1] || this.uv[2] != data.uv[2] || this.uv[3] != data.uv[3]) {
        //         //                 this.uv = data.uv;
        //         //                 uvDirty = true;
        //         //             } else {
        //         //                 uvDirty = false;
        //         //             }
        //         //         } else {
        //         //             this.uv = data.uv;
        //         //             uvDirty = true;
        //         //         }
        //         //     } else {
        //         //         if(this.uv) {
        //         //             this.uv = null;
        //         //             uvDirty = true;
        //         //         } else {
        //         //             uvDirty = false;
        //         //         }
        //         //     }
        //         // }
        //
        //         // if(filter != this.filter || uvDirty) {
        //             // this.filter = filter;
        //             // this.uv = data.uv;
        //             // this.context.startShader(drawingTexture, filter, data.uv);
        //             // this.shaderStarted = false;
        //         // }
        //     } else {
        //         // if(!this.shaderStarted || this.drawingTexture != drawingTexture) {
        //             // this.filter = null;
        //             // this.drawingTexture = drawingTexture;
        //             // this.context.startShader(drawingTexture, null, null);
        //             // this.shaderStarted = true;
        //         // }
        //     }
        // }

        private globalMatrix:Matrix = new Matrix();
        private savedGlobalMatrix:Matrix = new Matrix();

        public setTransform(a:number, b:number, c:number, d:number, tx:number, ty:number):void {
            this.globalMatrix.setTo(a, b, c, d, tx, ty);
        }

        public transform(a:number, b:number, c:number, d:number, tx:number, ty:number):void {
            this.globalMatrix.append(a, b, c, d, tx, ty);
        }

        public translate(dx:number, dy:number):void {
            this.globalMatrix.translate(dx, dy);
        }

        public saveTransform():void {
            this.savedGlobalMatrix.copyFrom(this.globalMatrix);
        }

        public restoreTransform():void {
            this.globalMatrix.copyFrom(this.savedGlobalMatrix);
        }

        private _globalAlpha:number = 1;

        public setGlobalAlpha(value:number) {
            this._globalAlpha = value;
        }

        public setGlobalCompositeOperation(value:string) {
            var len = this.drawData.length;
            // 有无遍历到有效绘图操作
            var drawState = false;
            for(var i = len - 1; i >= 0; i--) {
                var data = this.drawData[i];

                if(data){
                    if(data.type != DRAWABLE_TYPE.BLEND && data.type != DRAWABLE_TYPE.PUSH_MASK && data.type != DRAWABLE_TYPE.POP_MASK) {
                        drawState = true;
                    }

                    // 如果与上一次blend操作之间无有效绘图，上一次操作无效
                    if(!drawState && data.type == DRAWABLE_TYPE.BLEND) {
                        this.drawData.splice(i, 1);
                        continue;
                    }

                    // 如果与上一次blend操作重复，本次操作无效
                    if(data.type == DRAWABLE_TYPE.BLEND) {
                        if(data.value == value) {
                            return;
                        } else {
                            break;
                        }
                    }
                }
            }

            this.drawData.push({type:DRAWABLE_TYPE.BLEND, value: value});
        }

        public pushMask(mask):void {

            // TODO mask count
            this.$stencilList.push(mask);

            // if (this.currentBatchSize >= this.size - 1) {
            if (this.vertexIndex >= this.vertexMaxSize - 1) {
                this.$drawWebGL();
                this.drawData.push({type: DRAWABLE_TYPE.PUSH_MASK, pushMask: mask, count: 0});
            } else {
                this.drawData.push({type: DRAWABLE_TYPE.PUSH_MASK, pushMask: mask, count: 0});
            }

            this.drawMask(mask);
        }

        public popMask():void {

            // TODO mask count
            var mask = this.$stencilList.pop();

            // if (this.currentBatchSize >= this.size - 1) {
            if (this.vertexIndex >= this.vertexMaxSize - 1) {
                this.$drawWebGL();
                this.drawData.push({type: DRAWABLE_TYPE.POP_MASK, popMask: mask, count: 0});
            } else {
                this.drawData.push({type: DRAWABLE_TYPE.POP_MASK, popMask: mask, count: 0});
            }

            this.drawMask(mask);
        }

        /**
         * @private
         * draw masks with default shader
         **/
        private drawMask(mask) {
            if (this.context.contextLost) {
                return;
            }

            var length = mask.length;
            if (length) {
                for (var i = 0; i < length; i++) {
                    var item:sys.Region = mask[i];
                    this.cacheArrays(0, 0, item.width, item.height, item.minX, item.minY, item.width, item.height, item.width, item.height);
                    // this.currentBatchSize++;
                    // this.drawData[this.drawData.length - 1].count++;
                    this.drawData[this.drawData.length - 1].count += 2;
                }
            }
            else {
                this.cacheArrays(0, 0, mask.width, mask.height, mask.x, mask.y, mask.width, mask.height, mask.width, mask.height);
                // this.currentBatchSize++;
                // this.drawData[this.drawData.length - 1].count++;
                this.drawData[this.drawData.length - 1].count += 2;
            }
        }

        /**
         * @private
         */
        private createRenderBuffer(width:number, height:number):WebGLRenderBuffer {
            var buffer = renderBufferPool.pop();
            width = Math.min(width, 1024);
            height = Math.min(height, 1024);
            if (buffer) {
                buffer.resize(width, height);
            }
            else {
                buffer = new WebGLRenderBuffer(width, height);
                buffer.$computeDrawCall = false;
            }
            return buffer;
        }

    }

    var renderBufferPool:WebGLRenderBuffer[] = [];//渲染缓冲区对象池
}
