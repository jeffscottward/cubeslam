var settings = require('../settings')
  , Body = require('../geom-sim/body')
  , shapes = require('../geom-sim/shapes')
  , AI = require('../ai')
  , Puppeteer = require('../puppeteer')
  , Editor = require('../level-editor')
  , see = require('../support/see')
  , keys = require('mousetrap')
  , mouse = require('../support/mouse')
  , World = require('../world')
  , geom = require('geom')
  , poly = geom.poly
  , vec = geom.vec
  , $ = require('jquery');

exports.Setup = {
  enter: function(ctx){
    createGame(ctx)

    var game = ctx.game
      , isLeft = 0
      , isRight = 0;

    this.update = function(world,timestep){
      if( world.paused ) return;
      isLeft  && game.emit('input',World.MOVE,-settings.data.keyboardSensitivity*10);
      isRight && game.emit('input',World.MOVE,+settings.data.keyboardSensitivity*10);
      mouse.tick() // will emit 'move' or 'click'
    }
    game.on('update',this.update)

    keys.bind(['left','a'],function(){ isLeft = 1; },'keydown')
    keys.bind(['left','a'],function(){ isLeft = 0; },'keyup')
    keys.bind(['right','d'],function(){ isRight = 1; },'keydown')
    keys.bind(['right','d'],function(){ isRight = 0; },'keyup')
    keys.bind(['up','w'],function(){ game.emit('input',World.SHOOT) })
    mouse.on('click',function(x,y,dt){ game.emit('input',World.SHOOT) })
    mouse.on('move',function(dx,dy,dt){ game.emit('input',World.MOVE,dx * settings.data.mouseSensitivity) })
    mouse.start()
  },

  leave: function(ctx){
    ctx.game.off('update',this.update)
    keys.unbind('right','keyup')
    keys.unbind('right','keydown')
    keys.unbind('left','keyup')
    keys.unbind('left','keydown')
    keys.unbind('up')
    mouse.off('click')
    mouse.off('move')
    mouse.stop()
  }
}


exports.Information = {
  enter: function(ctx){
    ctx.game.actions.gameResume() // allow for controls
    ctx.renderer.changeView("play");

    var info = $('.state.game-info');
    this.play = info.find(".play").show()
    this.play.on('click',function(){ see('/game/start') });
    keys.bind('space', function(){ see('/game/start') });
  },

  leave: function(ctx){
    this.play.off('click');
    keys.unbind('space');
  }
}


exports.Waiting = {
  enter: function(ctx){},
  leave: function(ctx){}
}

exports.Start = {

  enter: function(ctx){
    ctx.game.reset();

    setupLevels(ctx)

    // add a puck to the center of the arena
    createPuck(ctx.game.world,ctx.game.actions)

    // (re)create paddles
    var world = ctx.game.world
      , w = (settings.data.arenaWidth/settings.data.arenaColumns*4)/settings.data.arenaWidth;
    world.players.a.paddle = createPaddle(world, 0, .5, 1, w, .08); // 0 means "top" (i.e. height*0)
    world.players.b.paddle = createPaddle(world, 1, .5, 0, w, .08); // 1 means "bottom" (i.e. height*1)

    // AI
    // singleplayer
    if( !ctx.multiplayer ){
      var paddle = world.paddles.get(world.opponent.paddle)
      ctx.ai = new AI(paddle);
      ctx.game.on('update',ctx.ai.update.bind(ctx.ai))
      $("#scoresSingleplayer").show();
      $("#scoresMultiplayer").hide();

    // multiplayer
    } else {
      // debug multiplayer AI
      if( ~window.location.href.indexOf('ai') ){
        var paddle = world.paddles.get(world.me.paddle)
        ctx.ai = new AI(paddle);
        ctx.game.on('update',ctx.ai.update.bind(ctx.ai))
      }

      // TODO networking input
      // ctx.network.on('move',function(frame,x){
      //   // Game#apply(frame,fn) rewinds the game to `frame` and calls `fn(world)`
      //   // then plays back to where it started re-adding the rewound keys.
      //   ctx.game.apply(frame,function(world){
      //     var paddle = world.paddles.get(world.opponent.paddle)
      //     paddle.current[0] = x;
      //   })
      // })

      ctx.renderer.swapToVideoTexture();
      $("#scoresMultiplayer").show();
      $("#scoresSingleplayer").hide();
    }

    this.play = function(){
      console.log('connected! now, let\'s play!')
      ctx.network.remote.send('game', 'start '+Date.now())
      see('/game/play')
    }
    // ctx.network.on('channel open',this.play)
    ctx.network.start()
  },

  leave: function(ctx){
    ctx.network.off('connected',this.play)
    ctx.puppeteer.off('update')
    ctx.puppeteer.off('game over')
    ctx.puppeteer.off('added')
    ctx.puppeteer.off('change')
    ctx.puppeteer = null
    ctx.editor = null
  }

}

exports.Play = {
  enter: function(ctx){
    // just in case we're not already here...
    ctx.renderer.changeView("play");

    var el = $('.countdown')
      , newone = el.clone(true);
    el.before(newone);
    $("." + el.attr("class") + ":last").remove();
    $("#countdown-cover").show().css({opacity:0}).animate({opacity:0.3},800)

    var countdown = function(nr) {
      if (nr > 0) {
        this.timeout = setTimeout(countdown, 1000, nr-1);
      } else {
        $("#countdown-cover").fadeOut()
        $("#gameScores").removeClass('inactive').addClass('active')
        keys.bind(['esc','space'], function(){ see('/game/pause') })
        ctx.game.emit('input',World.PLAY)
      }
    }.bind(this)

    // wait until we're in play view
    var offset = ctx.latency || 0;
    this.timeout = setTimeout(function(){
      console.log('starting countdown')
      countdown(3)
    }, 1000 - offset);
  },


  leave: function(ctx){
    clearTimeout(this.timeout);
    keys.unbind('esc')
    keys.unbind('space')
    ctx.game.emit('input',World.PAUSE)
  }
}


exports.Pause = {
  enter: function(ctx){
    $('.playFriend',ctx.el)
      .toggle(!ctx.multiplayer) // hidden if we already play in multiplayer
      .on('click',function(){ see('/friend/invite') })

    // TODO listen if the other player resumes the game
    //      when in multiplayer

    $('.play',ctx.el)
      .on('click',function(){ see('/game/play') })

    keys.bind('space', function(){ see('/game/play') })
  },
  leave: function(ctx){
    keys.unbind('space')
    $('.playFriend',ctx.el).off('click');
    $('.play',ctx.el).off('click');
  }
}


exports.Over = {
  enter: function(ctx){
    $("#scoreboardMulti").toggle(ctx.multiplayer)
    $("#scoreboardSingle").toggle(!ctx.multiplayer)
    $("#highscoreRally").html( ctx.game.world.maxAlive )

    $('.playFriend',ctx.el)
      .attr('disabled',!ctx.multiplayer)
      .on('click',function(){ see('/friend/invite') })

    function restart(){
      if(!ctx.multiplayer){
        see('/game/start')
      } else {
        // TODO check ctx.network.pathname
        console.error('multiplayer restart not implemented')
      }
      return false;
    }

    keys.bind('space',restart)
    $('#gameOverDialog .play').on('click',restart)

    ctx.renderer.changeView("gameOver");
  },

  leave: function(ctx){
    keys.unbind('space')
    $('#gameOverDialog .play').off('click')
  }
}

function setupLevels(ctx){
  var game = ctx.game;

  // the puppeteer takes care of the levels
  ctx.puppeteer = new Puppeteer(game.actions)
  ctx.editor = new Editor(ctx.puppeteer)

  // add the level to the level editor
  ctx.puppeteer.on('added',function(level){ ctx.editor.add(level) })
  ctx.puppeteer.on('change',function(level){
    // keep a reference to the current level in world
    // (it's just easier in the actions this way)
    game.world.level = this.levels[level]
    settings.changeTheme(game.world.level.theme)

    $("#level").html(level+1);

    // restart game
    if( ctx.pathname == '/game/play' )
      see('/game/start')
  })

  // check if game is over multiplayer or singleplayer (defined below)
  ctx.puppeteer.on('update', ctx.multiplayer ? multiplayer : singleplayer)

  ctx.puppeteer.on('game over',function(level){
    $("#highscoreLevels").html( ctx.puppeteer.level+1 )
    ctx.renderer.triggerEvent("gameOver");
    see('/game/over')
  })
  ctx.puppeteer.add(require('../levels/level1'));
  ctx.puppeteer.add(require('../levels/level2'));
  ctx.puppeteer.add(require('../levels/level3'));
  ctx.puppeteer.add(require('../levels/level4'));
  ctx.puppeteer.add(require('../levels/level5'));
  ctx.puppeteer.add(require('../levels/level6'));
  ctx.puppeteer.add(require('../levels/level7'));
  ctx.puppeteer.add(require('../levels/level8'));

  // let the puppeteer listen to updates
  ctx.game.on('update',ctx.puppeteer.update.bind(ctx.puppeteer))

  // debug shortcut
  var RE_DBG_LEVEL = /[&?]level=(\d+)/g;
  if( RE_DBG_LEVEL.exec(window.location.href) ){
    var level = parseInt(RegExp.$1)-1;
    console.log('DEBUG LEVEL',level)
    ctx.puppeteer.goto(level)
  } else {
    ctx.puppeteer.goto(0)
  }
}

function createGame(ctx){
  var world = ctx.game.world
    , w = (settings.data.arenaWidth/settings.data.arenaColumns*4)/settings.data.arenaWidth;

  // create temporary paddles (for "playing with" during information)
  // will be removed on game.reset() and then added again in /game/start
  world.players.a.paddle = createPaddle(world, 0, .5, 1, w, .08); // 0 means "top" (i.e. height*0)
  world.players.b.paddle = createPaddle(world, 1, .5, 0, w, .08); // 1 means "bottom" (i.e. height*1)

  // easy player access
  world.me = world.host ? world.players.a : world.players.b;
  world.opponent = world.host ? world.players.b : world.players.a;
}


function createPuck(world,actions){
  // add to center of arena
  var id = 'p:' + world.puckIndex++
    , x = settings.data.arenaWidth/2
    , y = settings.data.arenaHeight/2
    , mass = 5;
  actions.puckCreate(id,x,y,mass,Body.DYNAMIC | Body.BOUNCE);

  // start it off with a push
  // TODO change the initial direction depending on who lost?
  actions.puckSpeed(id, 0, world.level.speed)
}

function createBullet(world,actions){
  // generate an id, x, y and v
  var id = 'b:' + world.me.paddle + ':' + world.bulletIndex++
    , c = world.paddles.get(world.me.paddle).current
    , v = world.me.paddle == 0 ? 30 : -30
    , columsWidth = settings.data.arenaWidth/settings.data.arenaColumns
    , x = Math.floor(c[0]/columsWidth)*columsWidth + columsWidth*.5;
  actions.bulletCreate(id,x,c[1]-v*10,v);
}

function createPaddle(world,id,x,y,w,h){
  var aw = settings.data.arenaWidth
  var ah = settings.data.arenaHeight
  var paddle = new Body(shapes.rect(w*aw,settings.data.puckRadius*6),x*aw,y*ah,Body.DYNAMIC | Body.BOUNCE | Body.STEER)
  paddle.id = id;
  paddle.damping = settings.data.paddleDamping;
  paddle.mass = settings.data.paddleMass;
  paddle.onbounds = function(b){
    // offset b to avoid intersection
    vec.add(paddle.current, b, paddle.current)

    // reset velocity by settings previous to current
    vec.copy(paddle.current, paddle.previous)
  }
  world.bodies.set(id,paddle);
  world.paddles.set(id,paddle);
  console.log('created paddle',w*aw,h*ah,x*aw,y*ah)
  return id;
}

// the level up/game over logic in singleplayer
function singleplayer(world,level){
  // level up if player b has more than maxHits
  if( world.players.b.hits.length >= level.maxHits ) {
    return this.up()
  }

  // game over if player a has more than maxHits
  if( world.players.a.hits.length >= level.maxHits )
    world.over = true;

  // emit game over if it happened
  if( world.over ){
    // who won?
    // TODO is this really the right place for this logic?
    world.winner = world.players.a.hits.length > world.players.b.hits.length
      ? world.players.b
      : world.players.a;

    this.over();
  }
}

// the level up/game over logic in multiplayer
function multiplayer(world,level){
  // game over it any player has more than maxHits
  //if( world.players.a.hits.length >= level.maxHits )
  if( world.players.a.hits.length >= 9 )
    world.over = true;

  //if( world.players.b.hits.length >= level.maxHits )
  if( world.players.b.hits.length >= 9 )
    world.over = true;

  // emit game over if it happened
  if( world.over ){
    // who won?
    // TODO is this really the right place for this logic?
    world.winner = world.players.a.hits.length > world.players.b.hits.length
      ? world.players.b
      : world.players.a;

    this.over();
  }
}