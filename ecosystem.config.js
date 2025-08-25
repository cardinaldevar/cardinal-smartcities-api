module.exports = {
  apps : [{
    name:"API Gemini",
    script: './server.js',
    watch       : true,
    instance_var: '0',
    env: {
      "NODE_ENV": "development",
    },
    env_production : {
       "NODE_ENV": "production"
    }
  }]

};
